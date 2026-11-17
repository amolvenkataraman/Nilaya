// Manual order: positions for something dropped between two neighbours (tasks in a project, board columns
// and cards, projects in the tree, saved views). One rule everywhere, the same the server applies, so an
// optimistic move lands where the server will put it: halfway between, one past the last, one before the
// first, or 1 in an empty list. Pure (candidate for lib/order.ts).

/** A position between neighbours `a` and `b`; either may be missing (dropped at an end). */
export function between(a?: number | null, b?: number | null): number {
  if (a == null) return b == null ? 1 : b - 1
  if (b == null) return a + 1
  return (a + b) / 2
}

/** Positions for `n` items dropped, in order, between two neighbours. */
export function positionsBetween(n: number, prev?: number | null, next?: number | null): number[] {
  if (prev == null && next == null) return Array.from({ length: n }, (_, i) => i + 1)
  if (next == null) return Array.from({ length: n }, (_, i) => (prev as number) + i + 1)
  if (prev == null) return Array.from({ length: n }, (_, i) => next - n + i)
  return Array.from({ length: n }, (_, i) => prev + ((next - prev) * (i + 1)) / (n + 1))
}
