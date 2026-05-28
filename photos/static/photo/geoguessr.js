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
            html: '<div style="font-size: 26px; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5)); transform: translate(-3px, -10px);">📍</div>',
            className: 'custom-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const actualIcon = L.divIcon({
            html: '<div style="font-size: 26px; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5));">🎯</div>',
            className: 'custom-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        // Add markers
        this.GuessMarker = L.marker(latlng, { icon: guessIcon }).addTo(this.Map);
        this.ActualMarker = L.marker(this.actualLatLng, { icon: actualIcon }).addTo(this.Map);

        // Draw connecting line
        this.DistanceLine = L.polyline([latlng, this.actualLatLng], {
            color: 'red',
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
