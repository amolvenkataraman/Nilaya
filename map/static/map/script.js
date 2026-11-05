// Escape user-controlled text before interpolating it into innerHTML
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Map Application Javascript
 * Organised, modularised, and cleaned up version of the map app script.
 */

const MapApp = {
    Config: {
        categoryIcons: {
            'house': '🏠',
            'business': '🏢',
            'school': '🏫',
            'university': '🎓',
            'restaurant': '🍽️',
            'shop': '🏪',
            'mall': '🛍️',
            'parking': '🅿️',
            'religious': '⛪',
            'hospital': '🏥',
            'transit': '🚉',
            'park': '🌳',
            'nature': '🏞️',
            'other': '📍'
        },
        defaultLocation: [43.4643, -80.5204], // Default to Waterloo if geo fails
        defaultZoom: 13
    },

    State: {
        markersByGroup: {},
        groupLayers: {},
        addLocationMode: false,
        locationGroups: [],
        currentHeatmap: null,
        heatmapAbortController: null
    },

    // API Services
    Service: {
        getCsrfToken() {
            return window.CSRF_TOKEN || '';
        },

        async fetchLocationGroups() {
            try {
                const response = await fetch('/map/location-groups/');
                if (!response.ok) throw new Error('Failed to load location groups');
                const groups = await response.json();
                MapApp.State.locationGroups = groups;
                MapApp.UI.renderGroupsList(groups);
            } catch (error) {
                console.error('Error fetching location groups:', error);
                alert('Could not retrieve location groups from server.');
            }
        },

        async fetchLocationsForGroup(groupId) {
            try {
                const response = await fetch(`/map/locations/?group=${groupId}`);
                if (!response.ok) throw new Error('Failed to load locations');
                const locations = await response.json();

                // Render layers on map
                MapApp.Map.renderGroupMarkers(groupId, locations);

                // Render lists in sidebar if option is checked
                MapApp.UI.renderGroupLocationsInSidebar(groupId, locations);
            } catch (error) {
                console.error(`Error fetching locations for group ${groupId}:`, error);
            }
        },

        async saveLocation(data) {
            const url = data.id ? `/map/locations/${data.id}/edit/` : '/map/locations/add/';
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': this.getCsrfToken()
                    },
                    body: JSON.stringify({
                        ...data,
                        group_id: data.group
                    })
                });
                const res = await response.json();
                if (res.status === 'success') {
                    MapApp.UI.closeLocationModal();
                    await this.fetchLocationGroups();
                    
                    // Refresh map layers for the modified group
                    if (data.group && MapApp.State.groupLayers[data.group]) {
                        await this.fetchLocationsForGroup(data.group);
                    }
                } else {
                    alert('Error saving location: ' + res.message);
                }
            } catch (error) {
                console.error('Error saving location:', error);
                alert('Network error while saving location.');
            }
        },

        async deleteLocation(locationId, groupId = null) {
            try {
                const response = await fetch(`/map/locations/${locationId}/delete/`, {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': this.getCsrfToken()
                    }
                });
                const res = await response.json();
                if (res.status === 'success') {
                    await this.fetchLocationGroups();
                    if (groupId) {
                        await this.fetchLocationsForGroup(groupId);
                    } else {
                        // Refresh all loaded groups
                        for (const gId of Object.keys(MapApp.State.groupLayers)) {
                            await this.fetchLocationsForGroup(gId);
                        }
                    }
                } else {
                    alert('Error deleting location: ' + res.message);
                }
            } catch (error) {
                console.error('Error deleting location:', error);
                alert('Network error while deleting location.');
            }
        },

        async saveGroup(data) {
            try {
                const response = await fetch('/map/location-groups/add/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': this.getCsrfToken()
                    },
                    body: JSON.stringify(data)
                });
                const res = await response.json();
                if (res.status === 'success') {
                    MapApp.UI.closeGroupModal();
                    await this.fetchLocationGroups();
                } else {
                    alert('Error creating group: ' + res.message);
                }
            } catch (error) {
                console.error('Error creating group:', error);
                alert('Network error while creating group.');
            }
        },

        async searchLocation(query) {
            try {
                const response = await fetch(`/map/nominatim/search/?q=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error('Geocoding search failed');
                return await response.json();
            } catch (error) {
                console.error('Error searching location:', error);
                return [];
            }
        }
    },

    // Map Functions
    Map: {
        init() {
            this.leafletMap = L.map('mapid').setView(MapApp.Config.defaultLocation, 2);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(this.leafletMap);

            this.setupMapClick();
            this.locateUser();
        },

        setupMapClick() {
            this.leafletMap.on('click', (e) => {
                if (MapApp.State.addLocationMode) {
                    MapApp.UI.showLocationModal({
                        id: '',
                        name: '',
                        category: '',
                        description: '',
                        address: '',
                        rating: '',
                        latitude: e.latlng.lat,
                        longitude: e.latlng.lng,
                        group_id: ''
                    });
                    
                    // Automatically toggle off mode
                    MapApp.State.addLocationMode = false;
                    document.getElementById('add-location-mode').classList.remove('active');
                    this.leafletMap.getContainer().style.cursor = '';
                }
            });
        },

        locateUser() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(position => {
                    const userLocation = [position.coords.latitude, position.coords.longitude];
                    this.leafletMap.setView(userLocation, MapApp.Config.defaultZoom);
                    
                    const userIcon = L.divIcon({
                        html: `<div style="font-size: 24px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">📍</div>`,
                        className: 'custom-div-icon',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });

                    L.marker(userLocation, {
                        icon: userIcon,
                        title: 'Your Location'
                    }).addTo(this.leafletMap);
                }, () => {
                    console.log("Geolocation permission denied or timed out.");
                });
            }
        },

        createCustomIcon(category) {
            const icon = MapApp.Config.categoryIcons[category] || MapApp.Config.categoryIcons['other'];
            return L.divIcon({
                html: `<div style="font-size: 24px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">${icon}</div>`,
                className: 'custom-div-icon',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
        },

        renderGroupMarkers(groupId, locations) {
            // Remove existing layers for this group
            if (MapApp.State.groupLayers[groupId]) {
                this.leafletMap.removeLayer(MapApp.State.groupLayers[groupId]);
            }

            const markers = [];
            locations.forEach(location => {
                const marker = L.marker([location.latitude, location.longitude], {
                    icon: this.createCustomIcon(location.category)
                });

                // Build modern custom popup element
                const popupDiv = document.createElement('div');
                popupDiv.className = 'popup-details';
                
                const icon = MapApp.Config.categoryIcons[location.category] || MapApp.Config.categoryIcons['other'];
                const starRating = location.rating ? '★'.repeat(location.rating) + '☆'.repeat(5 - location.rating) : '';
                
                popupDiv.innerHTML = `
                    <div class="popup-icon">${icon}</div>
                    <strong>${esc(location.name)}</strong><br>
                    <span class="text-muted" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">${esc(location.category)}</span><br>
                    ${location.description ? `<div class="popup-desc">${esc(location.description)}</div>` : ''}
                    ${location.address ? `<div class="popup-addr">${esc(location.address)}</div>` : ''}
                    ${location.rating ? `<div class="popup-rating">${starRating}</div>` : ''}
                    <div class="popup-actions-row">
                        <button class="btn btn-sm btn-outline-secondary edit-popup-btn">✏️ Edit</button>
                        <button class="btn btn-sm btn-outline-danger delete-popup-btn">🗑️ Delete</button>
                    </div>
                `;

                // Add popup click events
                popupDiv.querySelector('.edit-popup-btn').addEventListener('click', () => {
                    marker.closePopup();
                    MapApp.UI.showLocationModal(location);
                });
                
                popupDiv.querySelector('.delete-popup-btn').addEventListener('click', () => {
                    if (confirm(`Are you sure you want to delete "${location.name}"?`)) {
                        marker.closePopup();
                        MapApp.Service.deleteLocation(location.id, groupId);
                    }
                });

                marker.bindPopup(popupDiv);
                markers.push(marker);
            });

            if (markers.length > 0) {
                MapApp.State.groupLayers[groupId] = L.layerGroup(markers).addTo(this.leafletMap);
            }
        },

        toggleGroupVisibility(groupId, visible) {
            if (MapApp.State.groupLayers[groupId]) {
                if (visible) {
                    this.leafletMap.addLayer(MapApp.State.groupLayers[groupId]);
                    MapApp.Service.fetchLocationsForGroup(groupId);
                } else {
                    this.leafletMap.removeLayer(MapApp.State.groupLayers[groupId]);
                    const groupDiv = document.getElementById(`group-${groupId}`);
                    if (groupDiv) groupDiv.innerHTML = '';
                    delete MapApp.State.groupLayers[groupId];
                }
            } else if (visible) {
                MapApp.Service.fetchLocationsForGroup(groupId);
            }
        },

        loadHeatmap(useDefaults = true) {
            if (MapApp.State.heatmapAbortController) {
                MapApp.State.heatmapAbortController.abort();
            }
            MapApp.State.heatmapAbortController = new AbortController();

            if (MapApp.State.currentHeatmap) {
                this.leafletMap.removeLayer(MapApp.State.currentHeatmap);
                MapApp.State.currentHeatmap = null;
            }

            const params = new URLSearchParams();
            params.append('vals', '1');

            if (useDefaults) {
                params.append('alt-', '1000');
            } else {
                const yearFilter = document.getElementById('year-filter').value;
                const yearMode = document.getElementById('year-mode').checked;
                const altitudeFilter = document.getElementById('altitude-filter').value;
                const specialOnly = document.getElementById('special-only').checked;

                if (yearMode) {
                    params.append('year', yearFilter);
                } else {
                    params.append('year-', yearFilter);
                }

                if (altitudeFilter === "0") {
                    params.append('alt-', 'NIL');
                } else {
                    params.append('alt-', altitudeFilter);
                }

                if (specialOnly) {
                    params.append('special', '1');
                }
            }

            fetch(`/photos/map/?${params.toString()}`, { signal: MapApp.State.heatmapAbortController.signal })
                .then(response => response.json())
                .then(data => {
                    const points = [];
                    for (const c of data['coords']) {
                        if (c[0] !== 0 && c[1] !== 0) {
                            points.push([c[0], c[1], 1]);
                        }
                    }

                    if (MapApp.State.currentHeatmap) {
                        this.leafletMap.removeLayer(MapApp.State.currentHeatmap);
                    }

                    // ?style=dot restores the original per-photo dot heatmap
                    // (heatmap.js / HeatmapOverlay); anything else uses the
                    // modern blurred "blob" heatmap.
                    const mapStyle = new URLSearchParams(window.location.search).get('style');

                    if (mapStyle === 'dot') {
                        const heatmapLayer = new HeatmapOverlay({
                            radius: 7,
                            maxOpacity: 0.9,
                            scaleRadius: false,
                            useLocalExtrema: true,
                            latField: 'lat',
                            lngField: 'lng',
                            valueField: 'count'
                        });
                        heatmapLayer.addTo(this.leafletMap);
                        heatmapLayer.setData({
                            max: 1,
                            data: points.map(p => ({ lat: p[0], lng: p[1], count: p[2] }))
                        });
                        MapApp.State.currentHeatmap = heatmapLayer;
                    } else {
                        MapApp.State.currentHeatmap = L.heatLayer(points, {
                            minOpacity: 0.3,
                            radius: 25,
                            blur: 20,
                            max: 1
                        }).addTo(this.leafletMap);
                    }
                })
                .catch(err => {
                    if (err.name === 'AbortError') return;
                    console.error('Error loading heatmap:', err);
                });
        }
    },

    // UI Rendering and Controllers
    UI: {
        init() {
            // Register Handlebars helper
            Handlebars.registerHelper('eq', function(a, b) {
                return a === b;
            });

            this.locationFormTemplate = Handlebars.compile(document.querySelector("#location-form-template").innerHTML);
            this.locationModal = new bootstrap.Modal(document.getElementById('locationModal'));
            this.groupModal = new bootstrap.Modal(document.getElementById('groupModal'));

            this.setupEventListeners();
        },

        setupEventListeners() {
            // Add location mode toggle
            document.getElementById('add-location-mode').addEventListener('click', function() {
                MapApp.State.addLocationMode = !MapApp.State.addLocationMode;
                this.classList.toggle('active');
                MapApp.Map.leafletMap.getContainer().style.cursor = MapApp.State.addLocationMode ? 'crosshair' : '';
            });

            // Toggle sidebar button
            document.getElementById('toggle-sidebar').addEventListener('click', function() {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.toggle('hidden');
                this.textContent = sidebar.classList.contains('hidden') ? '☰' : '✕';
            });

            // Tab switching logic
            document.querySelectorAll('.tab-nav-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Remove active class from all buttons and panes
                    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));

                    // Add active class to clicked button and target pane
                    btn.classList.add('active');
                    const target = btn.getAttribute('data-target');
                    const targetPane = document.querySelector(target);
                    if (targetPane) {
                        targetPane.classList.add('active');
                    }
                });
            });

            // Sidebar refresh button
            document.getElementById('refresh-data').addEventListener('click', () => {
                MapApp.Service.fetchLocationGroups();
            });

            // Save location button in modal
            document.getElementById('saveLocationBtn').addEventListener('click', () => {
                const form = document.getElementById('location-form');
                const formData = new FormData(form);
                const data = Object.fromEntries(formData.entries());
                
                if (data.rating) {
                    data.rating = parseInt(data.rating, 10);
                }

                if (!data.group) {
                    alert('Please select a group');
                    return;
                }

                MapApp.Service.saveLocation(data);
            });

            // Save group button in modal
            document.getElementById('saveGroupBtn').addEventListener('click', () => {
                const form = document.getElementById('group-form');
                const formData = new FormData(form);
                const data = {
                    name: formData.get('name'),
                    description: formData.get('description'),
                    is_public: formData.get('is_public') === 'on'
                };

                MapApp.Service.saveGroup(data);
            });

            // Add group button trigger modal
            document.getElementById('add-group').addEventListener('click', () => {
                document.getElementById('group-form').reset();
                this.groupModal.show();
            });

            // Search autocomplete events
            this.setupSearchAutocomplete();

            // Heatmap events
            this.setupHeatmapEvents();

            // Option: show location lists checkbox
            document.getElementById('show-location-lists').addEventListener('change', () => {
                Object.keys(MapApp.State.groupLayers).forEach(groupId => {
                    if (MapApp.State.groupLayers[groupId]) {
                        MapApp.Service.fetchLocationsForGroup(groupId);
                    }
                });
            });

            // View photos bound click
            document.getElementById('view-photos').addEventListener('click', () => {
                const bounds = MapApp.Map.leafletMap.getBounds();
                const n = bounds._northEast.lat.toFixed(5);
                const s = bounds._southWest.lat.toFixed(5);
                const e = bounds._northEast.lng.toFixed(5);
                const w = bounds._southWest.lng.toFixed(5);
                const b64 = btoa(`${n},${s},${e},${w}`);
                window.open(`/photos/?bounds=${b64}`, '_blank');
            });
        },

        setupSearchAutocomplete() {
            let searchTimeout;
            const searchInput = document.getElementById('location-search');
            const searchResults = document.getElementById('search-results');

            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length < 3) {
                    searchResults.classList.add('hidden');
                    return;
                }
                
                searchTimeout = setTimeout(async () => {
                    const results = await MapApp.Service.searchLocation(query);
                    this.renderSearchResults(results, searchInput, searchResults);
                }, 500);
            });

            // Close dropdown clicking outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.classList.add('hidden');
                }
            });
        },

        renderSearchResults(results, searchInput, searchResults) {
            searchResults.innerHTML = '';
            if (results.length === 0) {
                searchResults.classList.add('hidden');
                return;
            }

            results.forEach(result => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.textContent = result.display_name;
                
                div.addEventListener('click', () => {
                    const location = {
                        id: '',
                        name: result.display_name.split(',')[0],
                        category: 'other',
                        description: '',
                        address: result.display_name,
                        rating: '',
                        latitude: parseFloat(result.lat),
                        longitude: parseFloat(result.lon),
                        group_id: ''
                    };
                    
                    MapApp.Map.leafletMap.setView([location.latitude, location.longitude], 16);
                    this.showLocationModal(location);
                    
                    searchInput.value = '';
                    searchResults.classList.add('hidden');
                });
                
                searchResults.appendChild(div);
            });
            
            searchResults.classList.remove('hidden');
        },

        setupHeatmapEvents() {
            // Slider value updates
            document.getElementById('year-filter').addEventListener('input', function() {
                document.getElementById('year-value').textContent = this.value;
            });

            document.getElementById('altitude-filter').addEventListener('input', function() {
                document.getElementById('altitude-value').textContent = 
                    this.value === "0" ? "No altitude data only" : `${this.value}m`;
            });

            // Reset filters to defaults
            document.getElementById('reset-filters').addEventListener('click', () => {
                const currentYear = new Date().getFullYear().toString();
                document.getElementById('year-filter').value = currentYear;
                document.getElementById('year-value').textContent = currentYear;
                document.getElementById('altitude-filter').value = "1000";
                document.getElementById('altitude-value').textContent = "1000m";
                document.getElementById('special-only').checked = false;
                document.getElementById('year-mode').checked = false;
                MapApp.Map.loadHeatmap(true);
            });

            // Load heatmap button
            document.getElementById('load-heatmap').addEventListener('click', () => {
                MapApp.Map.loadHeatmap(false);
            });
        },

        renderGroupsList(groups) {
            const sidebarContent = document.getElementById('sidebar-content');
            sidebarContent.innerHTML = '';

            groups.forEach(group => {
                const div = document.createElement('div');
                div.className = 'group-item';
                div.innerHTML = `
                    <div class="group-header">
                        <div>
                            <strong>${esc(group.name)}</strong>
                            ${group.is_public ? '🌍' : '🔒'}
                        </div>
                        <label>
                            <input type="checkbox" data-group-id="${group.id}">
                        </label>
                    </div>
                    <div class="group-locations" id="group-${group.id}">
                        <!-- Locations loaded inside -->
                    </div>
                `;

                // Checkbox toggle listener
                div.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    MapApp.Map.toggleGroupVisibility(group.id, isChecked);
                });

                sidebarContent.appendChild(div);
            });
        },

        renderGroupLocationsInSidebar(groupId, locations) {
            const groupDiv = document.getElementById(`group-${groupId}`);
            const showLists = document.getElementById('show-location-lists').checked;
            
            if (!showLists || !groupDiv) {
                if (groupDiv) groupDiv.innerHTML = '';
                return;
            }

            const icons = MapApp.Config.categoryIcons;
            groupDiv.innerHTML = locations.map(location => `
                <div class="location-marker">
                    ${icons[location.category] || icons['other']} &nbsp; ${esc(location.name)}
                    <span class="category-badge">${esc(location.category)}</span>
                    <div class="location-actions">
                        <button class="action-btn edit-location" data-location-json='${encodeURIComponent(JSON.stringify(location))}'>✏️</button>
                        <button class="action-btn delete-location" data-id="${location.id}">🗑️</button>
                    </div>
                </div>
            `).join('');

            // Click bindings
            groupDiv.querySelectorAll('.edit-location').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const location = JSON.parse(decodeURIComponent(btn.dataset.locationJson));
                    this.showLocationModal(location);
                });
            });

            groupDiv.querySelectorAll('.delete-location').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this location?')) {
                        MapApp.Service.deleteLocation(btn.dataset.id, groupId);
                    }
                });
            });
        },

        showLocationModal(location = null) {
            const modalTitle = document.getElementById('locationModalTitle');
            const modalBody = document.getElementById('locationModalBody');
            
            modalTitle.textContent = location && location.id ? 'Edit Location' : 'Add New Location';
            
            const templateData = location || {
                id: '',
                name: '',
                category: 'other',
                description: '',
                address: '',
                rating: '',
                latitude: MapApp.Map.leafletMap.getCenter().lat,
                longitude: MapApp.Map.leafletMap.getCenter().lng,
                group_id: ''
            };
            
            templateData.ratings = [1, 2, 3, 4, 5];
            templateData.groups = MapApp.State.locationGroups;
            
            modalBody.innerHTML = this.locationFormTemplate(templateData);
            this.locationModal.show();
        },

        closeLocationModal() {
            this.locationModal.hide();
        },

        closeGroupModal() {
            this.groupModal.hide();
        }
    }
};

// Initialise App on Page Load
document.addEventListener('DOMContentLoaded', () => {
    MapApp.Map.init();
    MapApp.UI.init();
    MapApp.Service.fetchLocationGroups();
});
