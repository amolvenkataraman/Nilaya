// The one place Leaflet is imported for the app: its stylesheet first, then the app's map rules on top
// (map.css), and Leaflet exposed as the global `L`, because leaflet.heat (a classic plugin) extends that global.
// Import `L` from here, never from 'leaflet', so the CSS order and the global are always in place.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
;(window as unknown as { L: typeof L }).L = L
export default L
