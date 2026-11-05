const GeoguessrEnt = {
    Map: null,
    GuessMarker: null,
    HeatmapLayer: null,
    HeatmapAbortController: null,

    init() {
        const defaultCenter = [43.6425662, -79.3870568];
        // Photo id and CSRF token come from data-* attributes on the page container.
        const page = document.querySelector('.geoguessr-ent-container');
        this.photoId = page.dataset.photoId || '';
        this.csrf = page.dataset.csrf || '';

        // Initialize Map
        this.Map = L.map('mapid').setView(defaultCenter, 10);
        this.GuessMarker = L.marker(defaultCenter).addTo(this.Map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(this.Map);

        this.setupEventListeners();
    },

    setupEventListeners() {
        // Map click
        this.Map.on('click', (e) => {
            this.updateLatLng(e.latlng.lat, e.latlng.lng);
        });

        // Snap Map events
        document.querySelectorAll('[data-action="snap"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const lat = parseFloat(btn.dataset.lat);
                const lng = parseFloat(btn.dataset.lng);
                const zoom = parseInt(btn.dataset.zoom || 18, 10);
                this.Map.setView([lat, lng], zoom);
            });
        });

        // Save preset events
        document.querySelectorAll('[data-action="save"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const lat = btn.dataset.lat ? parseFloat(btn.dataset.lat) : null;
                const lng = btn.dataset.lng ? parseFloat(btn.dataset.lng) : null;
                this.updateLatLng(lat, lng, true);
            });
        });

        // Skip button
        const skipBtn = document.getElementById('btn-skip');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                location.reload();
            });
        }

        // Heatmap toggle button
        const heatmapBtn = document.getElementById('btn-heatmap');
        if (heatmapBtn) {
            heatmapBtn.addEventListener('click', () => {
                this.toggleHeatmap(heatmapBtn);
            });
        }
    },

    async updateLatLng(lat, lng, refresh = false) {
        if (lat !== null && lng !== null) {
            this.GuessMarker.setLatLng([lat, lng]);
        }

        try {
            const response = await fetch('/photos/geoguessr_ent/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.csrf
                },
                body: JSON.stringify({
                    photo: this.photoId,
                    lat: lat,
                    lng: lng
                })
            });

            const res = await response.json();
            if (res.status === 'success') {
                location.reload();
            } else {
                alert('Failed to save coordinates: ' + (res.message || 'unknown error'));
            }
        } catch (error) {
            console.error('Error saving coordinates:', error);
            alert('Network error while saving coordinates.');
        }
    },

    toggleHeatmap(btn) {
        if (this.HeatmapLayer) {
            this.Map.removeLayer(this.HeatmapLayer);
            this.HeatmapLayer = null;
            btn.classList.remove('active');
            btn.textContent = 'Load heatmap';
            if (this.HeatmapAbortController) {
                this.HeatmapAbortController.abort();
                this.HeatmapAbortController = null;
            }
            return;
        }

        btn.classList.add('active');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading…';

        if (this.HeatmapAbortController) {
            this.HeatmapAbortController.abort();
        }
        this.HeatmapAbortController = new AbortController();

        fetch('/photos/map/?vals=y', { signal: this.HeatmapAbortController.signal })
            .then(response => response.json())
            .then(res => {
                const pj1 = [];
                for (const c of res['coords']) {
                    if (c[0] !== 0 && c[1] !== 0) {
                        pj1.push({ lat: c[0], lng: c[1], count: 1 });
                    }
                }

                if (this.HeatmapLayer) {
                    this.Map.removeLayer(this.HeatmapLayer);
                }

                const cfg = {
                    "radius": 7,
                    "maxOpacity": .9,
                    "scaleRadius": false,
                    "useLocalExtrema": true,
                    latField: 'lat',
                    lngField: 'lng',
                    valueField: 'count'
                };

                this.HeatmapLayer = new HeatmapOverlay(cfg).addTo(this.Map);
                this.HeatmapLayer.setData({ max: 1, data: pj1 });

                btn.textContent = 'Hide heatmap';
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                console.error('Error loading heatmap:', err);
                btn.classList.remove('active');
                btn.textContent = 'Load heatmap';
                this.HeatmapLayer = null;
            });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    GeoguessrEnt.init();
});
