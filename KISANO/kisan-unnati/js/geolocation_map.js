// ============================================================================
// js/geolocation_map.js — High-Accuracy Farm GPS + Esri Satellite Map Fallback
// ============================================================================

export class FarmlandGeolocationManager {
  constructor(talukaDirectory, i18n, onPlotConfirmedCallback) {
    this.talukas = talukaDirectory || [];
    this.i18n = i18n;
    this.onPlotConfirmed = onPlotConfirmedCallback;

    this.map = null;
    this.marker = null;
    this.selectedCoords = {
      lat: 18.5204,
      lon: 73.8567,
      accuracy: 15,
      isOnFieldGps: true,
      district: 'Pune',
      taluka: 'Haveli',
      agroZone: 'Western Maharashtra Transition Zone'
    };
  }

  init() {
    this.populateTalukaDropdown();
    this.bindModalEvents();

    // Check if farmer already has a saved plot in localStorage
    const savedPlot = localStorage.getItem('kisan_saved_plot');
    if (savedPlot) {
      try {
        this.selectedCoords = JSON.parse(savedPlot);
        document.getElementById('onboarding-modal').classList.add('hidden');
        this.triggerConfirmation();
        return;
      } catch (e) {
        console.warn('Invalid cached plot, showing onboarding modal.');
      }
    }
  }

  populateTalukaDropdown() {
    const select = document.getElementById('select-taluka-preset');
    if (!select) return;
    select.innerHTML = '';

    this.talukas.forEach((item, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${item.district} — ${item.taluka} (${item.zone})`;
      select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
      const chosen = this.talukas[Number(e.target.value)];
      if (chosen) {
        this.updateMapPin(chosen.lat, chosen.lon, chosen.district, chosen.taluka, chosen.zone);
      }
    });
  }

  bindModalEvents() {
    const modal = document.getElementById('onboarding-modal');
    const btnYes = document.getElementById('btn-at-farm-yes');
    const btnNo = document.getElementById('btn-at-farm-no');
    const btnConfirmMap = document.getElementById('btn-confirm-map-location');
    const btnReopen = document.getElementById('btn-reopen-modal');

    // Reopen modal from top navbar
    if (btnReopen) {
      btnReopen.addEventListener('click', () => {
        modal.classList.remove('hidden');
      });
    }

    // PATH A: Farmer clicks "YES, I am currently at my farmland"
    btnYes.addEventListener('click', () => {
      this.captureHighAccuracyFarmGPS();
    });

    // PATH B: Farmer clicks "NO, I am at home/market (Open Satellite Map + Taluka)"
    btnNo.addEventListener('click', () => {
      const drawer = document.getElementById('map-fallback-drawer');
      drawer.classList.remove('hidden');
      this.initSatelliteMap();
    });

    // Confirm Satellite Pin-Drop or Taluka selection
    btnConfirmMap.addEventListener('click', () => {
      this.selectedCoords.isOnFieldGps = false;
      this.selectedCoords.accuracy = 50;
      modal.classList.add('hidden');
      this.triggerConfirmation();
    });
  }

  captureHighAccuracyFarmGPS() {
    const statusBox = document.getElementById('gps-status-msg');
    statusBox.classList.remove('hidden');
    statusBox.textContent = '🛰️ उपग्रहाद्वारे शेताचे अचूक GPS स्थान लॉक केले जात आहे... (Locking Hardware GPS...)';

    if (!('geolocation' in navigator)) {
      statusBox.textContent = '⚠️ GPS उपलब्ध नाही. कृपया खालील नकाशावर तुमचा तालुका निवडा.';
      document.getElementById('map-fallback-drawer').classList.remove('hidden');
      this.initSatelliteMap();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const nearest = this.findNearestTaluka(latitude, longitude);

        this.selectedCoords = {
          lat: Number(latitude.toFixed(6)),
          lon: Number(longitude.toFixed(6)),
          accuracy: Math.round(accuracy || 12),
          isOnFieldGps: true,
          district: nearest.district,
          taluka: nearest.taluka,
          agroZone: nearest.zone
        };

        statusBox.textContent = `✅ शेत GPS लॉक झाले! (${this.selectedCoords.lat}, ${this.selectedCoords.lon} | अचूकता: ±${this.selectedCoords.accuracy}m)`;

        setTimeout(() => {
          document.getElementById('onboarding-modal').classList.add('hidden');
          this.triggerConfirmation();
        }, 550);
      },
      (err) => {
        console.warn('High-accuracy GPS fallback:', err.message);
        statusBox.textContent = '⚠️ थेट GPS सिग्नल मिळाला नाही. कृपया खालील उपग्रह नकाशावर शेत निवडा:';
        document.getElementById('map-fallback-drawer').classList.remove('hidden');
        this.initSatelliteMap();
      },
      {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 0
      }
    );
  }

  initSatelliteMap() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 150);
      return;
    }

    this.map = L.map('satellite-map').setView([this.selectedCoords.lat, this.selectedCoords.lon], 13);

    // Esri World Imagery Satellite Layer + Hybrid Place Labels
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
    }).addTo(this.map);

    this.marker = L.marker([this.selectedCoords.lat, this.selectedCoords.lon], { draggable: true }).addTo(this.map);

    // Tap anywhere on satellite map to move farm plot pin
    this.map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      const nearest = this.findNearestTaluka(lat, lng);
      this.updateMapPin(lat, lng, nearest.district, nearest.taluka, nearest.zone);
    });

    this.marker.on('dragend', () => {
      const pos = this.marker.getLatLng();
      const nearest = this.findNearestTaluka(pos.lat, pos.lng);
      this.updateMapPin(pos.lat, pos.lng, nearest.district, nearest.taluka, nearest.zone);
    });

    setTimeout(() => this.map.invalidateSize(), 200);
  }

  updateMapPin(lat, lon, district, taluka, zone) {
    this.selectedCoords.lat = Number(lat.toFixed(6));
    this.selectedCoords.lon = Number(lon.toFixed(6));
    this.selectedCoords.district = district;
    this.selectedCoords.taluka = taluka;
    this.selectedCoords.agroZone = zone;

    if (this.marker && this.map) {
      this.marker.setLatLng([lat, lon]);
      this.map.panTo([lat, lon]);
    }
  }

  findNearestTaluka(lat, lon) {
    let best = this.talukas[0] || { district: 'Pune', taluka: 'Haveli', zone: 'Western Maharashtra Zone' };
    let minD = Infinity;
    this.talukas.forEach((t) => {
      const d = Math.hypot(t.lat - lat, t.lon - lon);
      if (d < minD) {
        minD = d;
        best = t;
      }
    });
    return best;
  }

  triggerConfirmation() {
    const acresInput = parseFloat(document.getElementById('input-plot-acres')?.value) || 2.5;
    const hasIrrigation = document.getElementById('select-irrigation')?.value === 'true';

    const payload = {
      ...this.selectedCoords,
      plotAcres: acresInput,
      hasIrrigation
    };

    localStorage.setItem('kisan_saved_plot', JSON.stringify(payload));

    if (typeof this.onPlotConfirmed === 'function') {
      this.onPlotConfirmed(payload);
    }
  }
}