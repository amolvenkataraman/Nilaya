// Building blocks for long forms, on the shared Field and Input: a titled section, a labelled text field, a
// labelled group of several controls, repeatable rows ("Add email") and a token input for tags. Written for the
// contact form; other forms (places, events) can use them once they move to components/ui.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Button, chipClass, Field, Input } from '../../components/ui'
import { LinkButton } from './LinkButton'
import { newRowKey, type Row } from './personFormState'

const labelClass = 'text-xs font-medium text-muted'

/** A titled part of a long form. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="p-0 pb-2 text-xs font-semibold tracking-[0.04em] text-muted uppercase">{title}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {children}
    </fieldset>
  )
}

export function TextField({
  label,
  value,
  onChange,
  max,
  placeholder,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  max: number
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <Field label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
      />
    </Field>
  )
}

/** Like Field, for a label over several controls (a date in three parts, a switch, tokens): not a <label>. */
export function FieldGroup({ label, labelId, children }: { label: string; labelId?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.25">
      <span id={labelId} className={labelClass}>
        {label}
      </span>
      {children}
    </div>
  )
}

const MAX_ROWS = 20

/** A section of repeatable rows: `render` draws one row's fields. A label field that comes prefilled takes
 * `data-row-label`, so a new row focuses its value instead. */
export function RepeatRows<T extends object>({
  title,
  hint,
  addLabel,
  items,
  onChange,
  blank,
  render,
}: {
  title: string
  hint?: string
  addLabel: string
  items: Row<T>[]
  onChange: (v: Row<T>[]) => void
  blank: () => T
  render: (row: Row<T>, update: (patch: Partial<T>) => void) => ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  const add = () => {
    onChange([...items, { ...blank(), _k: newRowKey() }])
    requestAnimationFrame(() => {
      const row = list.current?.lastElementChild
      row?.querySelector<HTMLElement>('input:not([data-row-label])')?.focus()
    })
  }
  return (
    <FormSection title={title} hint={hint}>
      <div className="grid gap-1.5 empty:hidden" ref={list}>
        {items.map((r) => (
          <div
            key={r._k}
            className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-start gap-1.5 max-md:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
          >
            {render(r, (p) => onChange(items.map((x) => (x._k === r._k ? { ...x, ...p } : x))))}
            <Button
              variant="ghost"
              size="sm"
              icon
              className="mt-0.5"
              aria-label={`Remove ${title.toLowerCase()}`}
              onClick={() => onChange(items.filter((x) => x._k !== r._k))}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
        ))}
      </div>
      {items.length < MAX_ROWS && (
        <LinkButton onClick={add}>
          <Icon name="plus" size={13} />
          {addLabel}
        </LinkButton>
      )}
    </FormSection>
  )
}

/** Chips with a text box: Enter or comma adds, Backspace on empty removes the last. */
export function TokenInput({
  value,
  onChange,
  suggestions,
  placeholder,
  labelledBy,
  listId,
}: {
  value: string[]
  onChange: (v: string[]) => void
  suggestions: string[]
  placeholder: string
  labelledBy: string
  listId: string
}) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const commit = (raw = text) => {
    const add = raw
      .split(',')
      .map((s) => s.trim().slice(0, 64))
      .filter(Boolean)
    const next = [...value]
    for (const a of add) if (!next.some((x) => x.toLowerCase() === a.toLowerCase())) next.push(a)
    if (next.length !== value.length) onChange(next)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Enter') {
      e.preventDefault()
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  const left = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the frame focuses the text box, which is the keyboard path
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className={
        'flex min-h-8 cursor-text flex-wrap items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.75 ' +
        'hover:border-[color-mix(in_srgb,var(--app-muted)_45%,var(--app-border))] ' +
        'focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)]'
      }
      onClick={() => input.current?.focus()}
    >
      {value.map((v) => (
        <span key={v} className={chipClass({ tone: 'content', removable: true })}>
          {v}
          <button
            type="button"
            className="grid size-4 place-items-center rounded-full border-0 bg-transparent p-0 text-muted hover:bg-hover hover:text-fg"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(value.filter((x) => x !== v))}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        className="h-6 min-w-20 flex-1 border-0 bg-transparent text-sm text-fg outline-none"
        value={text}
        list={listId}
        onChange={(e) => (e.target.value.endsWith(',') ? commit(e.target.value) : setText(e.target.value))}
        onKeyDown={onKey}
        onBlur={() => text.trim() && commit()}
        placeholder={value.length ? '' : placeholder}
        aria-labelledby={labelledBy}
        maxLength={200}
        autoComplete="off"
      />
      <datalist id={listId}>
        {left.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
