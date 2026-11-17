// Building blocks of the calendar settings drawer and dialogs: a titled section (a rule between sections) and a
// row with a label, an optional explanation and a control at the right (usually a Switch).
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function SettingsSection({ id, title, danger, children }: { id: string; title: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 [&+section]:border-t [&+section]:border-border [&+section]:pt-4" aria-labelledby={id}>
      <h3 id={id} className={cn('flex gap-1.5 text-sm', danger && 'text-danger')}>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function SettingRow({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="grid flex-1 gap-0.5 text-sm">
        <strong className="font-medium">{label}</strong>
        {help && <span className="text-xs text-muted">{help}</span>}
      </div>
      {children}
    </div>
  )
}

/** A Switch's visually hidden name (the row's label says it on screen). */
export const srOnly = (text: string) => <span className="sr-only">{text}</span>
