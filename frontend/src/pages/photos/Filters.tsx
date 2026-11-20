// Photos filters drawer (like the classic Filters panel) and the timeline's month scrubber. The drawer edits a
// draft of the FILTER_KEYS params and writes them all on "Show photos".
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, buttonClass, chipClass, Drawer, DrawerBody, DrawerHead, Field, FieldRow, Input, Select, Switch } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import { browseQuery } from './queries'
import { BOUNDS, FILTER_KEYS, type FilterKey, filterCount } from './timelineState'
import { placeText } from '../../lib/format'

/** Blur score presets (higher is sharper; the viewer shows the same score). */
const SHARPNESS: [string, string, string][] = [
  ['Blurry', '', '50'],
  ['Soft', '50', '150'],
  ['Sharp', '150', ''],
]
const EMPTY = Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>

export function FiltersButton() {
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false)
  const n = filterCount(params)
  return (
    <>
      <button type="button" className={buttonClass({ size: 'sm', pressed: n > 0 })} onClick={() => setOpen(true)} title="Filters">
        <Icon name="filter" size={14} />
        <span>Filters{n ? ` · ${n}` : ''}</span>
      </button>
      {open && <FiltersDrawer onClose={() => setOpen(false)} />}
    </>
  )
}

/** A labelled group of buttons (a <label> would send clicks to its first button). */
function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.25">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

const choice = (on: boolean) => cn(chipClass({ tone: on ? 'accent' : 'neutral' }), 'cursor-pointer', !on && 'hover:text-fg')

function FiltersDrawer({ onClose }: { onClose: () => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [f, setF] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<FilterKey, string>)
  const cameras = useQuery(browseQuery('cameras')).data ?? []
  const countries = useQuery(browseQuery('countries')).data ?? []
  const cities = useQuery(browseQuery('cities')).data ?? []
  const objects = useQuery(browseQuery('objects')).data ?? []
  const cityList = useMemo(() => (f.country ? cities.filter((c) => c.country === f.country) : cities), [cities, f.country])
  const picked = f.objects ? f.objects.split(',') : []
  const set = (k: FilterKey, v: string) => setF((x) => ({ ...x, [k]: v }))
  const area = BOUNDS.every((k) => f[k])
  const num = (v: string) => v.replace(/[^\d.]/g, '').slice(0, 8)
  const apply = () => {
    const p = new URLSearchParams()
    for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k])
    navigate(`/photos${p.toString() ? `?${p}` : ''}`)
    onClose()
  }
  return (
    <Drawer open onClose={onClose} label="Photo filters">
      <DrawerHead>
        <strong className="flex-1">Filters</strong>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </Button>
      </DrawerHead>
      <DrawerBody className="gap-4">
        <Switch checked={f.kind === 'videos'} onChange={(v) => set('kind', v ? 'videos' : '')} label="Videos only" />
        <FieldRow>
          <Field label="Taken on or after">
            <Input type="date" value={f.from} max={f.date || undefined} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="Taken on or before">
            <Input type="date" value={f.date} min={f.from || undefined} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </FieldRow>
        <Switch checked={f.order === 'oldest'} onChange={(v) => set('order', v ? 'oldest' : '')} label="Oldest first" />
        <FieldRow>
          <Field label="Camera">
            <Select value={f.camera} onChange={(e) => set('camera', e.target.value)}>
              <option value="">Any camera</option>
              {cameras.map((c) => (
                <option key={c.value} value={c.value}>
                  {placeText(c.display)} · {c.count}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Make contains">
            <Input value={f.camera_make} maxLength={64} placeholder="e.g. Canon" onChange={(e) => set('camera_make', e.target.value)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Country">
            <Select value={f.country} onChange={(e) => setF((x) => ({ ...x, country: e.target.value, city: '' }))}>
              <option value="">Any country</option>
              {countries.map((c) => (
                <option key={c.value} value={c.value}>
                  {placeText(c.display)} · {c.count}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City">
            <Select value={f.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">Any city</option>
              {cityList.map((c) => (
                <option key={c.value + c.country} value={c.value}>
                  {c.value} · {c.count}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Group label="Objects">
          {objects.length === 0 ? (
            <span className="text-xs text-muted">No objects detected in your library yet.</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {objects.map((o) => {
                const on = picked.includes(o.value)
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={choice(on)}
                    aria-pressed={on}
                    onClick={() => set('objects', (on ? picked.filter((x) => x !== o.value) : [...picked, o.value]).join(','))}
                  >
                    {placeText(o.display)} <span className="text-muted">{o.count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Group>
        <Group label="Sharpness (blur score: higher is sharper; photos only)">
          <div className="flex flex-wrap gap-1">
            {SHARPNESS.map(([label, lo, hi]) => {
              const on = f.min_blur === lo && f.max_blur === hi
              return (
                <button
                  key={label}
                  type="button"
                  className={choice(on)}
                  aria-pressed={on}
                  onClick={() => setF((x) => ({ ...x, min_blur: on ? '' : lo, max_blur: on ? '' : hi }))}
                >
                  {label} <span className="text-muted">{lo && hi ? `${lo}–${hi}` : lo ? `over ${lo}` : `under ${hi}`}</span>
                </button>
              )
            })}
          </div>
          <FieldRow>
            <Field label="From">
              <Input inputMode="decimal" value={f.min_blur} placeholder="0" onChange={(e) => set('min_blur', num(e.target.value))} />
            </Field>
            <Field label="To">
              <Input inputMode="decimal" value={f.max_blur} placeholder="Any" onChange={(e) => set('max_blur', num(e.target.value))} />
            </Field>
          </FieldRow>
        </Group>
        {area && (
          <Group label="Map area">
            <span className="flex items-center gap-2">
              <span className={chipClass({ tone: 'accent' })}>
                <Icon name="map" size={12} />
                In the area picked on the map
              </span>
              <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, north: '', south: '', east: '', west: '' }))}>
                Remove
              </Button>
            </span>
          </Group>
        )}
        <p className="text-xs text-muted">Free text (places, things, cameras, dates) goes in the search box at the top.</p>
        <p className="text-xs text-muted">Libraries: switch them on or off, or pick "Only", in the sidebar.</p>
      </DrawerBody>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" onClick={() => setF(EMPTY)}>
          Clear all
        </Button>
        <span className="flex-1" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply}>
          Show photos
        </Button>
      </div>
    </Drawer>
  )
}

const scrubItem =
  'rounded-xs border-0 bg-transparent px-1.5 py-0.5 text-right text-3xs whitespace-nowrap hover:bg-accent-soft hover:text-accent'

/** Right-edge month rail: jump the timeline to any month of the library. */
export function Scrubber({ first, last }: { first: string | null; last: string | null }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  if (!first || !last) return null
  const a = new Date(first)
  const b = new Date(last)
  const months: Date[] = []
  for (
    let d = new Date(b.getFullYear(), b.getMonth(), 1);
    d >= new Date(a.getFullYear(), a.getMonth(), 1) && months.length < 240;
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  )
    months.push(d)
  if (months.length < 2) return null
  const current = params.get('date')
  const go = (d: Date) => {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const p = new URLSearchParams(params)
    p.set('date', `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
    p.delete('photo')
    navigate(`/photos?${p}`)
    window.scrollTo({ top: 0 })
  }
  return (
    <nav
      className={
        'fixed top-[calc(var(--topbar-h)+4rem)] right-1 bottom-4 z-15 flex flex-col overflow-y-auto rounded-md p-1 [scrollbar-width:none] ' +
        'bg-[color-mix(in_srgb,var(--app-surface)_80%,transparent)] opacity-35 transition-opacity duration-150 ' +
        'focus-within:opacity-100 focus-within:shadow-pop hover:opacity-100 hover:shadow-pop max-[1000px]:hidden'
      }
      aria-label="Jump to month"
      data-scrubber
    >
      <button
        type="button"
        className={cn(scrubItem, !current ? 'bg-accent-soft text-accent' : 'text-muted')}
        onClick={() => {
          const p = new URLSearchParams(params)
          p.delete('date')
          navigate(`/photos${p.toString() ? `?${p}` : ''}`)
        }}
      >
        Now
      </button>
      {months.map((d, i) => {
        const yearStart = i === 0 || d.getMonth() === 11
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const on = !!current?.startsWith(key)
        return (
          <button
            key={key}
            type="button"
            className={cn(
              scrubItem,
              yearStart && 'mt-1 font-bold',
              on ? 'bg-accent-soft text-accent' : yearStart ? 'text-fg' : 'text-muted',
            )}
            onClick={() => go(d)}
            title={fmtDate(d, { month: 'long', year: 'numeric' })}
          >
            {yearStart ? d.getFullYear() : fmtDate(d, { month: 'short' })}
          </button>
        )
      })}
    </nav>
  )
}
