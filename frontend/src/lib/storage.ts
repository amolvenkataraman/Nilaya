// Per-device preferences in localStorage (a collapsed panel, a chosen layout, a dismissed hint). Never data that
// must survive: storage can be blocked or cleared, so every read falls back to the default and writes may fail
// silently. Values keep the formats already stored: booleans as '1'/'0', strings as is, numbers as text, and
// arrays/objects (and Sets, as arrays) as JSON.
import { useCallback, useState } from 'react'

type Pref = boolean | string | number | readonly unknown[] | Set<unknown> | Record<string, unknown>

function decode<T extends Pref>(raw: string, fallback: T): T {
  if (typeof fallback === 'boolean') return (raw === '1' || raw === 'true') as T
  if (typeof fallback === 'number') return (Number.isFinite(Number(raw)) ? Number(raw) : fallback) as T
  if (typeof fallback === 'string') return raw as T
  const parsed: unknown = JSON.parse(raw)
  if (fallback instanceof Set) return new Set(Array.isArray(parsed) ? parsed : []) as T
  return (parsed ?? fallback) as T
}

function encode(value: Pref): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value instanceof Set ? [...value] : value)
}

export function readPref<T extends Pref>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : decode(raw, fallback)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: Pref | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, encode(value))
  } catch {
    /* storage blocked or full: the preference just isn't kept */
  }
}

/** useState that remembers its value on this device under `key`. */
export function usePref<T extends Pref>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(() => readPref(key, fallback))
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        writePref(key, v)
        return v
      }),
    [key],
  )
  return [value, set]
}
