// Dialogs, the side drawer and the confirm dialog, on Base UI's Dialog: focus trap, scroll lock, Escape and
// outside clicks close only the topmost one (a Confirm opened from a dialog closes alone).
// On phones a dialog is a bottom sheet.
import { Dialog as Base } from '@base-ui/react/dialog'
import { useRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../Icon'
import { useLayer } from '../layers'
import { Button } from './button'

const backdrop =
  'fixed inset-0 z-70 bg-scrim transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 in-[body:has(.viewer)]:z-86'

/** Focus what a child already took (React autoFocus), else the first field in the body, else its first button. */
function firstFocus(popup: HTMLElement | null): HTMLElement | boolean {
  if (!popup) return true
  if (popup.contains(document.activeElement) && document.activeElement !== popup) return document.activeElement as HTMLElement
  const body = popup.querySelector('[data-dialog-body]')
  return (
    body?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]),textarea,select') ??
    body?.querySelector<HTMLElement>('button') ??
    popup.querySelector<HTMLElement>('[data-dialog-foot] button') ??
    true
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** CSS width on desktop, e.g. "26rem" (default 32rem). */
  width?: string
  className?: string
}

export function Dialog({ open, onClose, title, children, footer, width, className }: DialogProps) {
  const popup = useRef<HTMLDivElement>(null)
  useLayer('dialog', open)
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className={backdrop} />
        <Base.Popup
          ref={popup}
          initialFocus={() => firstFocus(popup.current)}
          style={width ? { width: `min(${width}, calc(100vw - 2rem))` } : undefined}
          className={cn(
            'dialog fixed top-[12vh] left-1/2 z-71 flex max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col',
            'rounded-[calc(var(--app-radius)+2px)] bg-surface shadow-pop outline-none in-[body:has(.viewer)]:z-87',
            // A dialog opened from this one (a Confirm) dims it, since Base UI draws no second backdrop.
            'data-nested-dialog-open:after:absolute data-nested-dialog-open:after:inset-0 data-nested-dialog-open:after:rounded-[inherit] data-nested-dialog-open:after:bg-scrim',
            'transition-[opacity,translate,scale] duration-150 ease-out data-ending-style:opacity-0 data-starting-style:translate-y-1.5 data-starting-style:scale-[0.985] data-starting-style:opacity-0',
            'max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-h-[92vh] max-md:w-full! max-md:translate-x-0 max-md:rounded-t-[12px] max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom,0)]',
            className,
          )}
        >
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
            <Base.Title className="grow text-md font-semibold">{title}</Base.Title>
            <Base.Close render={<Button variant="ghost" size="sm" icon aria-label="Close" />}>
              <Icon name="x" />
            </Base.Close>
          </div>
          <div data-dialog-body className="dialog-body grid gap-3 overflow-auto px-4 pt-2 pb-4">
            {children}
          </div>
          {footer && (
            <div data-dialog-foot className="dialog-foot flex items-center gap-2 border-t border-border px-4 py-3">
              {footer}
            </div>
          )}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

/** A yes/no question. Danger-styled by default (most are deletes). */
export function Confirm({
  open,
  title,
  body,
  children,
  confirmLabel = 'Delete',
  danger = true,
  disabled = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body?: ReactNode
  /** Extra content under the body, e.g. a field to type a name into. */
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  disabled?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="26rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'solid-danger' : 'primary'}
            disabled={disabled}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <p className="text-sm text-muted">{body}</p>}
      {children}
    </Dialog>
  )
}

/** A panel that slides in from the right (task details, calendar settings, filters). */
export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const popup = useRef<HTMLDivElement>(null)
  useLayer('drawer', open)
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className={cn(backdrop, 'z-64')} />
        <Base.Popup
          ref={popup}
          aria-label={label}
          initialFocus={popup}
          className={cn(
            'drawer fixed inset-y-0 right-0 z-65 flex w-[min(30rem,100vw)] flex-col border-l border-border bg-surface',
            'shadow-[-12px_0_32px_rgba(16,24,40,0.08)] outline-none',
            'transition-[opacity,translate] duration-200 ease-out data-ending-style:translate-x-6 data-ending-style:opacity-0 data-starting-style:translate-x-6 data-starting-style:opacity-0',
          )}
        >
          {children}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

/** Drawer header and scrolling body, for content that doesn't bring its own layout. */
export function DrawerHead({ children }: { children: ReactNode }) {
  return <div className="flex h-12 flex-none items-center gap-2 border-b border-border pr-2 pl-4">{children}</div>
}

export function DrawerBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid flex-1 content-start gap-3 overflow-y-auto px-4 pt-3 pb-8', className)}>{children}</div>
}
