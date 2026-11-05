// leaflet.heat (a classic Leaflet plugin) extends the global `L`; expose the bundled Leaflet first.
import L from 'leaflet'
;(window as unknown as { L: typeof L }).L = L
export default L
