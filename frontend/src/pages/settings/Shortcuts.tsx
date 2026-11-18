// Settings › Keyboard shortcuts: every app's keys (shortcutList.ts), in a dense grid per app.
import { Fragment } from 'react'
import { cn } from '../../lib/cn'
import { SHORTCUTS } from './shortcutList'
import { cardClass, Kbd, SettingsSection } from '../../components/ui'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** "g t" -> G T as key caps; "j / k" keeps the slash as text. */
export function Keys({ keys }: { keys: string }) {
  const parts = keys.split(' ')
  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, i) =>
        (part === '/' && keys !== '/') || part === '–' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
          <span key={i}>{part}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
          <Kbd key={i}>{part === 'Ctrl' && mac ? '⌘' : part.length === 1 ? part.toUpperCase() : part}</Kbd>
        ),
      )}
    </span>
  )
}

export function ShortcutsSection() {
  const cell = '-mt-px flex items-center justify-between gap-2 border-t border-border px-4 text-sm'
  return (
    <SettingsSection id="set-keys" title="Keyboard shortcuts" description="Letters work when you're not typing in a field.">
      <div className={cn(cardClass, 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] overflow-hidden')}>
        {SHORTCUTS.map(([title, rows], g) => (
          <Fragment key={title}>
            {g > 0 && <h3 className={cn(cell, 'col-span-full pt-3 pb-1.5 text-xs font-semibold text-muted')}>{title}</h3>}
            {rows.map(([keys, label]) => (
              <div key={keys + label} className={cn(cell, 'py-2.5')}>
                <span>{label}</span>
                <Keys keys={keys} />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </SettingsSection>
  )
}
