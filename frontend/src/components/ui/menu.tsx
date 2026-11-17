// Action menus on Base UI's Menu (arrow keys, typeahead, Escape closes only the menu) and free-form popovers
// on Base UI's Popover (for content with fields, such as a date picker). Both sit above every other surface
// except toasts, because they always open from the topmost one.
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Popover as BasePopover } from '@base-ui/react/popover'
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../Icon'
import { useLayer } from '../layers'

/** Props a trigger element must spread (`<button {...p}>`): ref, click and keyboard handlers, ARIA state. */
export type TriggerProps = ComponentPropsWithRef<'button'>

type Align = 'start' | 'center' | 'end'
type Side = 'top' | 'bottom' | 'left' | 'right'

const surface =
  'z-89 min-w-48 max-w-[min(22rem,calc(100vw-16px))] rounded-md bg-surface text-sm shadow-pop outline-none ' +
  'origin-(--transform-origin) transition-[opacity,scale] duration-100 ease-out data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0'

/** Inside a Base UI menu, items are Base UI items; inside a Popover they're plain buttons that look the same. */
const InMenu = createContext(false)

export interface MenuProps {
  trigger: (props: TriggerProps) => ReactElement
  /** The items; `close` is for items that do something the menu shouldn't wait for. */
  children: (close: () => void) => ReactNode
  align?: Align
  side?: Side
  width?: string
  label?: string
}

export function Menu({ trigger, children, align = 'start', side = 'bottom', width, label }: MenuProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useLayer('menu', open)
  return (
    <BaseMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <BaseMenu.Trigger render={(props) => trigger(props as TriggerProps)} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={4} collisionPadding={8} className="z-89 outline-none">
          <BaseMenu.Popup aria-label={label} style={width ? { width } : undefined} className={cn('menu p-1', surface)}>
            <InMenu.Provider value={true}>{children(close)}</InMenu.Provider>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

const item =
  'flex min-h-8 w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.25 text-left text-sm text-fg no-underline outline-none ' +
  'select-none data-highlighted:bg-hover data-disabled:opacity-50 hover:no-underline [&>svg]:shrink-0 [&>svg]:text-muted'

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  end,
  href,
  active,
  disabled,
}: {
  icon?: string
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  /** Right-aligned: a shortcut, a count, a check mark. */
  end?: ReactNode
  href?: string
  active?: boolean
  disabled?: boolean
}) {
  const inMenu = useContext(InMenu)
  const className = cn(item, danger && 'text-danger', active && 'bg-hover')
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      <span className="truncate">{children}</span>
      {end != null && <span className="ml-auto text-xs text-muted">{end}</span>}
    </>
  )
  if (inMenu) {
    return (
      <BaseMenu.Item
        onClick={onClick}
        disabled={disabled}
        render={href ? (props) => <a {...props} href={href} /> : undefined}
        className={className}
      >
        {inner}
      </BaseMenu.Item>
    )
  }
  const plain = cn(className, 'hover:bg-hover focus-visible:bg-hover')
  return href ? (
    <a role="menuitem" href={href} onClick={onClick} className={plain}>
      {inner}
    </a>
  ) : (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={plain}>
      {inner}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />
}

/** A heading or note inside a menu (not an item). */
export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-2 pt-1.5 pb-1 text-xs font-medium text-muted', className)}>{children}</div>
}

/** Free-form content anchored to a trigger. Same trigger contract as Menu. */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width,
  label,
  flush = false,
  className,
}: MenuProps & {
  /** No inner padding: for panels with their own header and footer edges (the notification bell). */
  flush?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useLayer('popover', open)
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger render={(props) => trigger(props as TriggerProps)} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={4} collisionPadding={8} className="z-89 outline-none">
          <BasePopover.Popup
            aria-label={label}
            style={width ? { width } : undefined}
            className={cn('menu', surface, !flush && 'p-1', className)}
            onKeyDown={moveBetweenItems}
          >
            {children(close)}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** Up/Down move between the menu items inside a popover (Base UI menus do this themselves). */
function moveBetweenItems(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items.at(next)?.focus()
}
