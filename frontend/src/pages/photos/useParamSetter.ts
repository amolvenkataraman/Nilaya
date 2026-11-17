// Set or clear one URL search param in place (history replace by default), dropping params that belong to the
// old view: changing a filter closes an open photo (?photo=). Several Photos pages had their own copy of this.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

const DROP = ['photo'] as const

export function useParamSetter(drop: readonly string[] = DROP) {
  const [params, setParams] = useSearchParams()
  const set = useCallback(
    (key: string, value: string | null, { replace = true }: { replace?: boolean } = {}) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (value) p.set(key, value)
          else p.delete(key)
          for (const d of drop) if (d !== key) p.delete(d)
          return p
        },
        { replace },
      ),
    [setParams, drop],
  )
  return [params, set] as const
}
