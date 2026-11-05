/* Photos > Map: heatmap of photo locations (#map-coords json_script: [[lat, lng, count], ...]),
 * GPX track overlay, and "Photos in this area" (opens the timeline filtered by the map bounds).
 * ?style=dot switches to the older per-photo dot heatmap. */
(function () {
    const map = L.map('mapid').setView([43.6425662, -79.3870568], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 28,
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const points = JSON.parse(document.getElementById('map-coords').textContent)
        .filter(c => c[0] != 0 && c[1] != 0)
        .map(c => [c[0], c[1], c[2] || 1]);

    if (new URLSearchParams(window.location.search).get('style') === 'dot') {
        const heatmapLayer = new HeatmapOverlay({
            radius: 7, maxOpacity: 0.9, scaleRadius: false, useLocalExtrema: true,
            latField: 'lat', lngField: 'lng', valueField: 'count',
        }).addTo(map);
        let max = 1;
        const data = points.map(c => { max = Math.max(max, c[2]); return { lat: c[0], lng: c[1], count: c[2] }; });
        heatmapLayer.setData({ max: max, data: data });
    } else {
        L.heatLayer(points, { minOpacity: 0.3, radius: 25, blur: 20, max: 1 }).addTo(map);
    }

    // The map lives in the app shell: re-measure when the sidebar opens/closes or the window resizes.
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('mapid'));

    document.querySelector('.show-photos-btn').addEventListener('click', () => {
        const b = map.getBounds();
        const b64 = btoa(`${b.getNorth().toFixed(5)},${b.getSouth().toFixed(5)},${b.getEast().toFixed(5)},${b.getWest().toFixed(5)}`);
        window.location.href = `/photos/?bounds=${encodeURIComponent(b64)}`;
    });

    const input = document.getElementById('inputfile');
    document.getElementById('gpx-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', function () {
        for (const f of this.files) {
            const color = f.name.includes("WALKING") ? "green" : "blue";
            const reader = new FileReader();
            reader.onload = () => {
                new L.GPX(reader.result, {
                    async: true,
                    display_wpt: false,
                    marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
                    polyline_options: { color: color },
                }).on('loaded', e => map.fitBounds(e.target.getBounds())).addTo(map);
            };
            reader.readAsText(f);
        }
    });
})();
