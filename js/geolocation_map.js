// ============================================================================
// js/geolocation_map.js — Labeled Hybrid Satellite Map & Village Search Engine
// Fixes blank terrain by using Google Hybrid Satellite (lyrs=y) which displays
// every Indian village, wadi, road, river, and gram panchayat label clearly,
// plus a 1-click toggle to OpenStreetMap Village view & live typeahead search.
// ============================================================================

export class FarmlandGeolocationManager {
  constructor(talukaDirectory, i18n, onPlotConfirmedCallback) {
    this.talukas = talukaDirectory || [];
    this.i18n = i18n;
    this.onPlotConfirmed = onPlotConfirmedCallback;

    this.map = null;
    this.marker = null;
    this.hybridLayer = null;
    this.streetLayer = null;
    this.searchDebounce = null;

    this.selectedCoords = {
      lat: 18.5204,
      lon: 73.8567,
      accuracy: 15,
      isOnFieldGps: true,
      village: 'हवेली (Haveli)',
      taluka: 'Haveli',
      district: 'Pune',
      state: 'Maharashtra',
      postcode: '411001',
      agroZone: 'Western Maharashtra Transition Zone'
    };
  }

  init() {
    this.populateTalukaDropdownAndChips();
    this.bindModalEvents();

    const savedPlot = localStorage.getItem('kisan_saved_plot');
    if (savedPlot) {
      try {
        this.selectedCoords = JSON.parse(savedPlot);
        document.getElementById('onboarding-modal').classList.add('hidden');
        this.triggerConfirmation();
        return;
      } catch {
        localStorage.removeItem('kisan_saved_plot');
      }
    }
  }

  populateTalukaDropdownAndChips() {
    const select = document.getElementById('select-taluka-preset');
    const chipsBox = document.getElementById('quick-taluka-chips');
    if (!select) return;

    select.innerHTML = '';
    if (chipsBox) {
      chipsBox.innerHTML = '<span class="text-slate-400 font-bold shrink-0">जलद निवड:</span>';
    }

    this.talukas.forEach((item, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${item.district} — ${item.taluka}`;
      select.appendChild(opt);

      if (chipsBox) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className =
          'shrink-0 bg-slate-100 hover:bg-emerald-50 hover:border-emerald-400 text-slate-700 border border-slate-300 px-2.5 py-0.5 rounded-full font-semibold transition-all';
        chip.textContent = item.taluka;
        chip.addEventListener('click', async () => {
          select.value = idx;
          if (this.map) this.map.setView([item.lat, item.lon], 14);
          await this.updateMapPinAndReverseGeocode(item.lat, item.lon);
        });
        chipsBox.appendChild(chip);
      }
    });

    select.addEventListener('change', async (e) => {
      const chosen = this.talukas[Number(e.target.value)];
      if (chosen) {
        if (this.map) this.map.setView([chosen.lat, chosen.lon], 14);
        await this.updateMapPinAndReverseGeocode(chosen.lat, chosen.lon);
      }
    });
  }

  bindModalEvents() {
    const modal = document.getElementById('onboarding-modal');
    const btnYes = document.getElementById('btn-at-farm-yes');
    const btnNo = document.getElementById('btn-at-farm-no');
    const btnConfirmMap = document.getElementById('btn-confirm-map-location');
    const btnReopen = document.getElementById('btn-reopen-modal');
    const btnSearchVillage = document.getElementById('btn-search-village');
    const inputSearchVillage = document.getElementById('input-village-search');
    const resultsDropdown = document.getElementById('village-search-results');

    btnReopen?.addEventListener('click', () => {
      modal.classList.remove('hidden');
      document.getElementById('map-fallback-drawer').classList.remove('hidden');
      this.initSatelliteMap();
    });

    btnYes?.addEventListener('click', () => {
      this.captureHighAccuracyFarmGPS();
    });

    btnNo?.addEventListener('click', () => {
      document.getElementById('map-fallback-drawer').classList.remove('hidden');
      this.initSatelliteMap();
    });

    btnConfirmMap?.addEventListener('click', () => {
      this.selectedCoords.isOnFieldGps = false;
      this.selectedCoords.accuracy = 20;
      modal.classList.add('hidden');
      this.triggerConfirmation();
    });

    // Layer switcher buttons
    const btnHybrid = document.getElementById('btn-layer-hybrid');
    const btnStreet = document.getElementById('btn-layer-street');

    btnHybrid?.addEventListener('click', () => {
      if (!this.map) return;
      if (this.streetLayer) this.map.removeLayer(this.streetLayer);
      if (this.hybridLayer) this.hybridLayer.addTo(this.map);
      btnHybrid.className = 'px-2.5 py-1 text-[11px] font-bold rounded-md bg-white text-slate-900 shadow-2xs';
      btnStreet.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-600 hover:text-slate-900';
    });

    btnStreet?.addEventListener('click', () => {
      if (!this.map) return;
      if (this.hybridLayer) this.map.removeLayer(this.hybridLayer);
      if (this.streetLayer) this.streetLayer.addTo(this.map);
      btnStreet.className = 'px-2.5 py-1 text-[11px] font-bold rounded-md bg-white text-slate-900 shadow-2xs';
      btnHybrid.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-600 hover:text-slate-900';
    });

    // Live Village Search + Typeahead Dropdown
    const performVillageLookup = async (queryText) => {
      if (!queryText || queryText.length < 2) {
        resultsDropdown?.classList.add('hidden');
        return;
      }
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
          queryText + ', Maharashtra, India'
        )}&limit=5&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'mr,hi,en' } });
        const list = await res.json();

        if (!list || list.length === 0) {
          resultsDropdown.innerHTML =
            '<div class="p-2.5 text-xs text-slate-500">गाव सापडले नाही. कृपया तालुक्याचे नाव जोडून शोधा.</div>';
          resultsDropdown.classList.remove('hidden');
          return;
        }

        resultsDropdown.innerHTML = list
          .map(
            (item, i) => `
            <button type="button" data-idx="${i}" class="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center justify-between gap-2">
              <span class="font-semibold text-slate-900 truncate">${item.display_name}</span>
              <span class="text-[10px] font-mono text-emerald-700 shrink-0">निवडा ➔</span>
            </button>
          `
          )
          .join('');
        resultsDropdown.classList.remove('hidden');

        resultsDropdown.querySelectorAll('button').forEach((b) => {
          b.addEventListener('click', async () => {
            const picked = list[Number(b.getAttribute('data-idx'))];
            resultsDropdown.classList.add('hidden');
            inputSearchVillage.value = picked.name || '';
            const lat = parseFloat(picked.lat);
            const lon = parseFloat(picked.lon);
            if (this.map) this.map.setView([lat, lon], 16);
            await this.updateMapPinAndReverseGeocode(lat, lon);
          });
        });
      } catch {
        resultsDropdown?.classList.add('hidden');
      }
    };

    inputSearchVillage?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounce);
      const val = e.target.value.trim();
      this.searchDebounce = setTimeout(() => performVillageLookup(val), 320);
    });

    btnSearchVillage?.addEventListener('click', () => {
      performVillageLookup(inputSearchVillage?.value?.trim());
    });
  }

  captureHighAccuracyFarmGPS() {
    const statusBox = document.getElementById('gps-status-msg');
    statusBox.classList.remove('hidden');
    statusBox.textContent = 'उपग्रहाद्वारे तुमच्या शेताचे अचूक GPS स्थान शोधले जात आहे...';

    if (!('geolocation' in navigator)) {
      statusBox.textContent = 'GPS उपलब्ध नाही. खालील नकाशावर तुमचे गाव निवडा.';
      document.getElementById('map-fallback-drawer').classList.remove('hidden');
      this.initSatelliteMap();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        await this.resolveExactLocality(latitude, longitude);
        this.selectedCoords.accuracy = Math.round(accuracy || 12);
        this.selectedCoords.isOnFieldGps = true;

        statusBox.textContent = `गाव निश्चित झाले: ${this.selectedCoords.village}, ता. ${this.selectedCoords.taluka}, जि. ${this.selectedCoords.district}`;

        setTimeout(() => {
          document.getElementById('onboarding-modal').classList.add('hidden');
          this.triggerConfirmation();
        }, 400);
      },
      () => {
        statusBox.textContent = 'थेट GPS परवानगी मिळाली नाही. खालील नकाशावर तुमचे गाव किंवा शेत निवडा:';
        document.getElementById('map-fallback-drawer').classList.remove('hidden');
        this.initSatelliteMap();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }

  initSatelliteMap() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 120);
      return;
    }

    this.map = L.map('satellite-map', { zoomControl: true }).setView(
      [this.selectedCoords.lat, this.selectedCoords.lon],
      14
    );

    // PRIMARY LAYER: Google Hybrid Satellite (High-res farmland + Indian Village Names, Roads & Rivers)
    this.hybridLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&hl=mr&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      attribution: 'Google Hybrid Satellite & Village Labels'
    });

    // SECONDARY LAYER: OpenStreetMap Detailed Village & Gat Map
    this.streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap Village & Road Data'
    });

    this.hybridLayer.addTo(this.map);

    this.marker = L.marker([this.selectedCoords.lat, this.selectedCoords.lon], {
      draggable: true
    }).addTo(this.map);

    this.map.on('click', async (e) => {
      await this.updateMapPinAndReverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    this.marker.on('dragend', async () => {
      const pos = this.marker.getLatLng();
      await this.updateMapPinAndReverseGeocode(pos.lat, pos.lng);
    });

    setTimeout(() => {
      this.map.invalidateSize();
      this.updateMapPinAndReverseGeocode(this.selectedCoords.lat, this.selectedCoords.lon);
    }, 200);
  }

  async updateMapPinAndReverseGeocode(lat, lon) {
    const cleanLat = Number(lat.toFixed(6));
    const cleanLon = Number(lon.toFixed(6));

    if (this.marker && this.map) {
      this.marker.setLatLng([cleanLat, cleanLon]);
      this.map.panTo([cleanLat, cleanLon]);
    }

    const addrSpan = document.getElementById('live-pin-address');
    const coordsSpan = document.getElementById('live-pin-coords');
    if (coordsSpan) coordsSpan.textContent = `${cleanLat}, ${cleanLon}`;
    if (addrSpan) addrSpan.textContent = 'गावाचे नाव शोधत आहे...';

    await this.resolveExactLocality(cleanLat, cleanLon);

    if (addrSpan) {
      addrSpan.textContent = `गाव: ${this.selectedCoords.village} | ता. ${this.selectedCoords.taluka}, जि. ${this.selectedCoords.district} ${
        this.selectedCoords.postcode ? '(' + this.selectedCoords.postcode + ')' : ''
      }`;
    }

    if (this.marker) {
      this.marker
        .bindPopup(
          `<div style="font-family:sans-serif;font-size:12px;line-height:1.4">
            <strong style="color:#0B3B24">${this.selectedCoords.village}</strong><br/>
            ता. ${this.selectedCoords.taluka}, जि. ${this.selectedCoords.district}
          </div>`
        )
        .openPopup();
    }
  }

  async resolveExactLocality(lat, lon) {
    const nearestPreset = this.findNearestTaluka(lat, lon);
    this.selectedCoords.lat = Number(lat.toFixed(6));
    this.selectedCoords.lon = Number(lon.toFixed(6));
    this.selectedCoords.agroZone = nearestPreset.zone;

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'mr,hi,en' } });
      if (!res.ok) throw new Error('Fallback geocode');
      const data = await res.json();
      const a = data.address || {};

      const village =
        a.village ||
        a.hamlet ||
        a.suburb ||
        a.town ||
        a.neighbourhood ||
        a.city ||
        nearestPreset.taluka;
      const taluka = a.county || a.municipality || a.city_district || nearestPreset.taluka;
      const district = (a.state_district || a.county || nearestPreset.district).replace(
        / District| जिल्हा/gi,
        ''
      );

      this.selectedCoords.village = village;
      this.selectedCoords.taluka = taluka;
      this.selectedCoords.district = district;
      this.selectedCoords.state = a.state || 'Maharashtra';
      this.selectedCoords.postcode = a.postcode || '';
    } catch {
      this.selectedCoords.village = nearestPreset.taluka;
      this.selectedCoords.taluka = nearestPreset.taluka;
      this.selectedCoords.district = nearestPreset.district;
      this.selectedCoords.state = 'Maharashtra';
      this.selectedCoords.postcode = '';
    }
  }

  findNearestTaluka(lat, lon) {
    let best = this.talukas[0] || {
      district: 'Pune',
      taluka: 'Haveli',
      zone: 'Western Maharashtra Transition Zone'
    };
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
    const farmerCategory = document.getElementById('select-farmer-category')?.value || 'General';

    const payload = {
      ...this.selectedCoords,
      plotAcres: acresInput,
      hasIrrigation,
      farmerCategory
    };

    localStorage.setItem('kisan_saved_plot', JSON.stringify(payload));
    if (typeof this.onPlotConfirmed === 'function') {
      this.onPlotConfirmed(payload);
    }
  }
}