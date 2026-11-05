const Geoguessr = {
    Map: null,
    GuessMarker: null,
    ActualMarker: null,
    DistanceLine: null,
    HasGuessed: false,

    init() {
        const defaultCenter = [43.6425662, -79.3870568];
        this.actualLatLng = [window.ACTUAL_LAT || 0, window.ACTUAL_LON || 0];

        // Initialize Map
        this.Map = L.map('mapid').setView(defaultCenter, 10);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(this.Map);

        this.setupEventListeners();
    },

    setupEventListeners() {
        this.Map.on('click', (e) => {
            if (this.HasGuessed) return;
            this.makeGuess(e.latlng);
        });

        const nextBtn = document.getElementById('next-photo-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                location.reload();
            });
        }
    },

    makeGuess(latlng) {
        this.HasGuessed = true;

        // Custom DivIcons
        const guessIcon = L.divIcon({
            html: '<svg class="gg-pin gg-pin-guess" xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" viewBox="0 0 16 16" aria-label="Your guess"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6"/></svg>',
            className: 'custom-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 29]
        });

        const actualIcon = L.divIcon({
            html: '<svg class="gg-pin gg-pin-actual" xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" viewBox="0 0 16 16" aria-label="Actual location"><circle cx="8" cy="8" r="7" fill="#fff"/><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10m0 1A6 6 0 1 0 8 2a6 6 0 0 0 0 12"/><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/><path d="M9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/></svg>',
            className: 'custom-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        // Add markers
        this.GuessMarker = L.marker(latlng, { icon: guessIcon }).addTo(this.Map);
        this.ActualMarker = L.marker(this.actualLatLng, { icon: actualIcon }).addTo(this.Map);

        // Draw connecting line
        this.DistanceLine = L.polyline([latlng, this.actualLatLng], {
            color: getComputedStyle(document.documentElement).getPropertyValue('--app-danger').trim() || '#c0392b',
            weight: 3,
            dashArray: '5, 10',
            opacity: 0.8
        }).addTo(this.Map);

        // Fit map bounds to show both points
        const group = new L.featureGroup([this.GuessMarker, this.ActualMarker]);
        this.Map.fitBounds(group.getBounds().pad(0.15));

        // Calculate distance
        const dist = this.Map.distance(latlng, this.actualLatLng);
        this.showResults(dist);
    },

    showResults(dist) {
        const overlay = document.getElementById('result-overlay');
        const distanceEl = document.getElementById('result-distance');
        const detailsEl = document.getElementById('result-details');

        let distanceStr = '';
        if (dist < 1000) {
            distanceStr = `${Math.round(dist)} meters`;
            distanceEl.className = 'result-distance close-guess';
        } else {
            const kms = Math.round(dist / 10) / 100;
            distanceStr = `${kms} kilometers`;
            if (kms < 10) {
                distanceEl.className = 'result-distance close-guess';
            } else if (kms > 100) {
                distanceEl.className = 'result-distance far-guess';
            } else {
                distanceEl.className = 'result-distance';
            }
        }

        distanceEl.textContent = distanceStr;
        detailsEl.innerHTML = `
            Your Guess: ${this.GuessMarker.getLatLng().lat.toFixed(5)}, ${this.GuessMarker.getLatLng().lng.toFixed(5)}<br>
            Actual Location: ${this.actualLatLng[0].toFixed(5)}, ${this.actualLatLng[1].toFixed(5)}
        `;

        overlay.classList.add('active');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Geoguessr.init();
});
