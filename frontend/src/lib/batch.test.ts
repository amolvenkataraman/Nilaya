import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const calls: string[] = []
vi.mock('./api', () => ({ get: async (path: string) => (calls.push(path), path === 'all' ? { a: 1, b: 2, c: 3 } : `only ${path}`) }))
const { queryGroup } = await import('./batch')

describe('queryGroup', () => {
  it('serves keys fetched together with one combined request and seeds the rest; a lone refetch uses its own endpoint', async () => {
    const qc = new QueryClient()
    const g = queryGroup('all', { a: { key: ['a'], path: 'a' }, b: { key: ['b'], path: 'b' }, c: { key: ['c'], path: 'c' } }, (all, k) => all[k])
    const [a, b] = await Promise.all([qc.fetchQuery({ queryKey: ['a'], queryFn: g('a') }), qc.fetchQuery({ queryKey: ['b'], queryFn: g('b') })])
    expect([a, b, qc.getQueryData(['c'])]).toEqual([1, 2, 3])
    expect(calls).toEqual(['all'])
    expect(await qc.fetchQuery({ queryKey: ['a'], queryFn: g('a'), staleTime: 0 })).toBe('only a')
    expect(calls).toEqual(['all', 'a'])
  })
})
