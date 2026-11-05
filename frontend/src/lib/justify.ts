// Justified rows (Google Photos / Flickr style): fill each row to the container width by
// scaling a run of photos to a common height near `target`. The last row keeps `target`
// height and is left-aligned instead of being stretched.

export interface Box { index: number; width: number; height: number }
export interface Row { height: number; boxes: Box[] }

export function justify(aspects: number[], width: number, target: number, gap: number, maxScale = 1.6): Row[] {
  const rows: Row[] = []
  if (width <= 0) return rows
  let start = 0
  let sum = 0
  for (let i = 0; i < aspects.length; i++) {
    const a = clampAspect(aspects[i])
    sum += a
    const n = i - start + 1
    const h = (width - gap * (n - 1)) / sum
    if (h <= target) {
      rows.push(makeRow(aspects, start, i, h, gap, width))
      start = i + 1
      sum = 0
    }
  }
  if (start < aspects.length) {
    // Last, partial row: natural height, but cap the scale for a lone very wide image.
    const n = aspects.length - start
    let s = 0
    for (let i = start; i < aspects.length; i++) s += clampAspect(aspects[i])
    const fill = (width - gap * (n - 1)) / s
    const h = Math.min(target, fill, target * maxScale)
    const boxes: Box[] = []
    for (let i = start; i < aspects.length; i++) {
      boxes.push({ index: i, width: Math.round(clampAspect(aspects[i]) * h), height: Math.round(h) })
    }
    rows.push({ height: Math.round(h), boxes })
  }
  return rows
}

function clampAspect(a: number): number {
  if (!isFinite(a) || a <= 0) return 1
  return Math.min(Math.max(a, 0.25), 5)
}

function makeRow(aspects: number[], start: number, end: number, h: number, gap: number, width: number): Row {
  const boxes: Box[] = []
  let used = 0
  for (let i = start; i <= end; i++) {
    const w = i === end ? width - used - gap * (end - start) : Math.round(clampAspect(aspects[i]) * h)
    boxes.push({ index: i, width: Math.max(1, w), height: Math.round(h) })
    used += i === end ? 0 : w
  }
  return { height: Math.round(h), boxes }
}
