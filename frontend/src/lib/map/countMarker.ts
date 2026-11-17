// One count marker (a gridCluster cluster) as a keyboard-focusable Leaflet marker. The number is a text node:
// Leaflet treats string content as HTML, so nothing from data ever reaches innerHTML.
import L from './leaflet'

export function countMarker(
  at: [number, number],
  { text, size, title, variant }: { text: string; size: number; title: string; variant?: 'heat' },
): L.Marker {
  const icon = L.divIcon({ className: variant ? `map-cluster ${variant}` : 'map-cluster', html: '', iconSize: [size, size] })
  const mk = L.marker(at, { icon, keyboard: true, title, riseOnHover: variant === 'heat' })
  mk.on('add', () => {
    const s = document.createElement('span')
    s.textContent = text
    mk.getElement()?.replaceChildren(s)
  })
  return mk
}
