// One request for a page's first load, its own endpoints after that.
// Several keys that are fetched in the same tick (a page mounting, or invalidating a whole prefix) are
// served by one combined endpoint, which also seeds the group's other keys. A single key refetched on
// its own (e.g. after a mutation invalidates just it) still uses its individual endpoint.
import type { QueryClient, QueryFunctionContext } from '@tanstack/react-query'
import { get } from './api'

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void }

export function queryGroup<K extends string>(combined: string, members: Record<K, { key: readonly unknown[]; path: string }>,
  pick: (all: Record<string, unknown>, k: K) => unknown) {
  let pending: { client: QueryClient; want: Map<K, Waiter[]> } | null = null

  const flush = async () => {
    const { client, want } = pending!
    pending = null
    const settle = (k: K, ok: boolean, v: unknown) => want.get(k)!.forEach((w) => (ok ? w.resolve(v) : w.reject(v)))
    const asked = [...want.keys()]
    if (asked.length === 1) {
      const k = asked[0]
      try { settle(k, true, await get(members[k].path)) } catch (e) { settle(k, false, e) }
      return
    }
    try {
      const all = await get<Record<string, unknown>>(combined)
      for (const k of Object.keys(members) as K[]) {
        const v = pick(all, k)
        if (want.has(k)) settle(k, true, v)
        else {
          // Seed the others unless they hold fresh data (don't overwrite a just-made optimistic change).
          const st = client.getQueryState(members[k].key)
          if (!st?.data || Date.now() - st.dataUpdatedAt > 30_000) client.setQueryData(members[k].key, v)
        }
      }
    } catch (e) {
      for (const k of asked) settle(k, false, e)
    }
  }

  /** queryFn for member `k` (use with the member's own key). */
  return <T>(k: K) => (ctx: QueryFunctionContext) =>
    new Promise<T>((resolve, reject) => {
      if (!pending) {
        pending = { client: ctx.client, want: new Map() }
        setTimeout(flush, 0)
      }
      const list = pending.want.get(k) ?? []
      list.push({ resolve: resolve as (v: unknown) => void, reject })
      pending.want.set(k, list)
    })
}
