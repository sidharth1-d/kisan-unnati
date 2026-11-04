// ============================================================================
// js/app.js — Enterprise Controller with Chart.js, Wikipedia Image API & Live AI
// ============================================================================

import { I18nVoiceEngine } from './i18n_voice.js';
import { FarmlandGeolocationManager } from './geolocation_map.js';
import { TelemetryFetcher } from './api_telemetry.js';
import { AgriculturalDecisionEngine } from './decision_engine.js';
import { KrishiMitraAI } from './ai_krishi_mitra.js';

class KisanUnnatiApp {
  constructor() {
    this.i18n = new I18nVoiceEngine();
    this.telemetryFetcher = new TelemetryFetcher();
    this.aiAdvisor = new KrishiMitraAI();

    this.kb = null;
    this.mandiData = null;
    this.decisionEngine = null;
    this.geoManager = null;

    this.activePlot = null;
    this.activeTelemetry = null;
    this.evaluatedCrops = [];
    this.selectedCropIndex = 0;
    this.currentAiContext = null;

    this.telemetryChart = null;
    this.chartMode = 'all';
    this.wikiImageCache = {};
  }

  async boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    const [kbRes, mandiRes] = await Promise.all([
      fetch('./data/agri_knowledge_base.json?v=4'),
      fetch('./data/mandi_latest.json?v=4')
    ]);
    this.kb = await kbRes.json();
    this.mandiData = await mandiRes.json();
    this.decisionEngine = new AgriculturalDecisionEngine(this.kb, this.mandiData);

    // Pre-resolve official Wikipedia REST API thumbnails so crop photos never fail
    this.prefetchWikipediaCropImages();

    await this.i18n.init(() => {
      if (this.activePlot && this.activeTelemetry) {
        this.renderFullDashboard(false);
      }
    });

    this.bindInteractiveDashboardControls();

    this.geoManager = new FarmlandGeolocationManager(
      this.kb.taluka_directory,
      this.i18n,
      async (confirmedPlot) => {
        await this.loadPlotAndCompute(confirmedPlot);
      }
    );
    this.geoManager.init();
    this.refreshIcons();
    // AI Diagnostics Inspector Listener
    const btnRunDiag = document.getElementById('btn-run-diagnostics');
    const diagOut = document.getElementById('ai-diagnostics-output');
    btnRunDiag?.addEventListener('click', async () => {
      if (diagOut) diagOut.textContent = 'Running diagnostics on self.LanguageModel and self.Translator...';
      const report = await this.aiAdvisor.runDiagnostics();
      if (diagOut) diagOut.textContent = report;
    });
  }

  // Official Wikipedia REST API Image Resolver (CORS-enabled, 100% reliable)
  async prefetchWikipediaCropImages() {
    if (!this.kb || !this.kb.crops) return;
    await Promise.allSettled(
      this.kb.crops.map(async (crop) => {
        if (!crop.wiki_taxon) return;
        try {
          const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(crop.wiki_taxon)}`
          );
          if (!res.ok) return;
          const data = await res.json();
          const imgUrl = data.thumbnail?.source || data.originalimage?.source;
          if (imgUrl) {
            this.wikiImageCache[crop.crop_id] = imgUrl;
            document.querySelectorAll(`img[data-crop-img="${crop.crop_id}"]`).forEach((imgEl) => {
              imgEl.src = imgUrl;
            });
          }
        } catch {
          // Keep verified Unsplash image_url fallback
        }
      })
    );
  }

  // High-contrast SVG data URI fallback if farmer is 100% offline
  buildOfflineCropSvg(cropName) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="280" viewBox="0 0 600 280">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0B3B24"/>
          <stop offset="100%" stop-color="#15803D"/>
        </linearGradient>
      </defs>
      <rect width="600" height="280" fill="url(#g)"/>
      <circle cx="520" cy="60" r="38" fill="#FBBF24" opacity="0.85"/>
      <path d="M0 230 Q180 180 350 220 T600 200 L600 280 L0 280 Z" fill="#062415" opacity="0.6"/>
      <text x="28" y="135" fill="#FFFFFF" font-family="sans-serif" font-size="26" font-weight="bold">${cropName}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  bindInteractiveDashboardControls() {
    const dashAcres = document.getElementById('dash-input-acres');
    const dashIrr = document.getElementById('dash-select-irrigation');
    const dashCat = document.getElementById('dash-select-category');

    const updateProfileFromBar = () => {
      if (!this.activePlot) return;
      this.activePlot.plotAcres = parseFloat(dashAcres?.value) || 2.5;
      this.activePlot.hasIrrigation = dashIrr?.value === 'true';
      this.activePlot.farmerCategory = dashCat?.value || 'General';
      localStorage.setItem('kisan_saved_plot', JSON.stringify(this.activePlot));
      this.recomputeCrops();
      this.renderFullDashboard(true);
    };

    dashAcres?.addEventListener('change', updateProfileFromBar);
    dashIrr?.addEventListener('change', updateProfileFromBar);
    dashCat?.addEventListener('change', updateProfileFromBar);

    document.getElementById('input-mandi-lot-qtl')?.addEventListener('input', () => {
      if (this.activePlot && this.activeTelemetry) this.renderFullDashboard(false);
    });
    document.getElementById('chk-shared-tempo')?.addEventListener('change', () => {
      if (this.activePlot && this.activeTelemetry) this.renderFullDashboard(false);
    });
    document.getElementById('select-season-filter')?.addEventListener('change', () => {
      this.selectedCropIndex = 0;
      if (this.activePlot && this.activeTelemetry) {
        this.recomputeCrops();
        this.renderFullDashboard(true);
      }
    });

    // Interactive 7-Day Chart Mode Filter Buttons
    document.querySelectorAll('.chart-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.chartMode = btn.getAttribute('data-chart-mode') || 'all';
        document.querySelectorAll('.chart-mode-btn').forEach((b) => {
          b.className =
            b === btn
              ? 'chart-mode-btn px-2.5 py-1 rounded-md bg-[#0B3B24] text-white'
              : 'chart-mode-btn px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900';
        });
        if (this.activeTelemetry) {
          this.render7DayTelemetryChart(this.activeTelemetry.weather.chart7Day);
        }
      });
    });

    // AI Engine Configuration Drawer
    const btnToggleConfig = document.getElementById('btn-toggle-ai-config');
    const configDrawer = document.getElementById('ai-config-drawer');
    const selectProvider = document.getElementById('select-ai-provider');
    const inputGeminiKey = document.getElementById('input-gemini-key');
    const btnSaveConfig = document.getElementById('btn-save-ai-config');
    const btnRegenAi = document.getElementById('btn-regenerate-ai');

    if (selectProvider) selectProvider.value = localStorage.getItem('kisan_ai_provider') || 'auto';
    if (inputGeminiKey) inputGeminiKey.value = localStorage.getItem('kisan_gemini_key') || '';

    btnToggleConfig?.addEventListener('click', () => {
      configDrawer?.classList.toggle('hidden');
    });

    btnSaveConfig?.addEventListener('click', async () => {
      localStorage.setItem('kisan_ai_provider', selectProvider.value);
      localStorage.setItem('kisan_gemini_key', inputGeminiKey.value.trim());
      configDrawer?.classList.add('hidden');
      if (this.currentAiContext) {
        await this.triggerLiveAiSummary();
      }
    });

    btnRegenAi?.addEventListener('click', async () => {
      if (this.currentAiContext) {
        await this.triggerLiveAiSummary();
      }
    });

    // Interactive AI Chat Question Submission
    const btnAskAi = document.getElementById('btn-ask-ai');
    const inputAiQ = document.getElementById('input-ai-question');

    const askQuestion = async (questionStr) => {
      if (!questionStr || !this.currentAiContext) return;
      const historyBox = document.getElementById('ai-chat-history');
      historyBox?.classList.remove('hidden');

      // Append User Question Bubble
      const qBubble = document.createElement('div');
      qBubble.className = 'bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-900';
      qBubble.textContent = `शेतकरी प्रश्न: ${questionStr}`;
      historyBox.appendChild(qBubble);

      // Append Streaming Answer Placeholder
      const aBubble = document.createElement('div');
      aBubble.className = 'bg-emerald-50/70 border border-emerald-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 space-y-1';
      aBubble.innerHTML = '<span class="text-emerald-800 font-semibold animate-pulse">कृषी-मित्र AI तुमच्या शेतातील डेटावरून उत्तर तयार करत आहे...</span>';
      historyBox.appendChild(aBubble);
      historyBox.scrollTop = historyBox.scrollHeight;

      document.getElementById('ai-tier-badge').textContent = 'Generating Live Response...';

      const res = await this.aiAdvisor.generateExecutiveAdvisory(
        this.currentAiContext,
        this.i18n.currentLang,
        questionStr
      );
      document.getElementById('ai-tier-badge').textContent = res.tierBadge;
      await this.aiAdvisor.streamTextIntoElement(aBubble, res.html);
      historyBox.scrollTop = historyBox.scrollHeight;
    };

    btnAskAi?.addEventListener('click', () => {
      const q = inputAiQ?.value?.trim();
      if (q) {
        inputAiQ.value = '';
        askQuestion(q);
      }
    });

    inputAiQ?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = inputAiQ?.value?.trim();
        if (q) {
          inputAiQ.value = '';
          askQuestion(q);
        }
      }
    });

    document.querySelectorAll('.ai-quick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const promptText = chip.getAttribute('data-prompt');
        askQuestion(promptText);
      });
    });
  }

  async triggerLiveAiSummary() {
    const contentEl = document.getElementById('ai-advisory-content');
    const badgeEl = document.getElementById('ai-tier-badge');
    const pulseDot = document.getElementById('ai-pulse-dot');

    if (badgeEl) badgeEl.textContent = 'Synthesizing Live Telemetry...';
    if (pulseDot) pulseDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping';
    if (contentEl) {
      contentEl.innerHTML =
        '<div class="text-xs text-slate-500 font-medium py-2">मातीचा सामू, मुळाशी ओलावा आणि बाजारभावावरून थेट AI विश्लेषण तयार होत आहे...</div>';
    }

    const aiResult = await this.aiAdvisor.generateExecutiveAdvisory(
      this.currentAiContext,
      this.i18n.currentLang
    );

    if (pulseDot) pulseDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    if (badgeEl) badgeEl.textContent = aiResult.tierBadge;
    await this.aiAdvisor.streamTextIntoElement(contentEl, aiResult.html);
  }

  refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  recomputeCrops() {
    const seasonFilter = document.getElementById('select-season-filter')?.value || 'ALL';
    this.evaluatedCrops = this.decisionEngine.evaluateCropsForPlot(
      this.activePlot,
      this.activeTelemetry,
      seasonFilter
    );
  }

  async loadPlotAndCompute(plot) {
    this.activePlot = plot;
    this.selectedCropIndex = 0;

    const dashAcres = document.getElementById('dash-input-acres');
    const dashIrr = document.getElementById('dash-select-irrigation');
    const dashCat = document.getElementById('dash-select-category');
    if (dashAcres) dashAcres.value = plot.plotAcres || 2.5;
    if (dashIrr) dashIrr.value = String(plot.hasIrrigation !== false);
    if (dashCat) dashCat.value = plot.farmerCategory || 'General';

    this.activeTelemetry = await this.telemetryFetcher.fetchAllPlotTelemetry(plot);

    this.activePlot.village = plot.village || this.activeTelemetry.locationInfo.village;
    this.activePlot.taluka = plot.taluka || this.activeTelemetry.locationInfo.taluka;
    this.activePlot.district = plot.district || this.activeTelemetry.locationInfo.district;

    this.i18n.autoSwitchByDetectedState(this.activeTelemetry.locationInfo.state);
    this.recomputeCrops();
    await this.renderFullDashboard(true);
  }

  async renderFullDashboard(refreshAi = false) {
    const lang = this.i18n.currentLang;
    const plot = this.activePlot;
    const tel = this.activeTelemetry;
    const topCrop = this.evaluatedCrops[this.selectedCropIndex] || this.evaluatedCrops[0];

    const lotSizeQtl = parseFloat(document.getElementById('input-mandi-lot-qtl')?.value) || 25;
    const splitTempo = document.getElementById('chk-shared-tempo')?.checked || false;

    const navBadge = document.getElementById('nav-location-badge');
    if (navBadge) {
      navBadge.textContent = `${plot.village}, ता. ${plot.taluka} (${plot.district})`;
    }

    document.getElementById('e-peek-text').textContent =
      this.kb.climate_macro.e_peek_pahani_alert[lang] || this.kb.climate_macro.e_peek_pahani_alert.mr;

    document.getElementById('gps-mode-pill').textContent = plot.isOnFieldGps
      ? `GPS: ${plot.lat}, ${plot.lon}`
      : `MAP PIN: ${plot.lat}, ${plot.lon}`;

    const seedPlan = this.decisionEngine.calculateSeedOrderPlan(topCrop, plot, tel.agroShops, lang);
    const mandiArb = this.decisionEngine.calculateMandiArbitrage(topCrop.crop_id, plot, lotSizeQtl, splitTempo);
    const storageList = this.decisionEngine.evaluateStorageOptions(plot, topCrop, lotSizeQtl);
    const regionalPrograms = this.decisionEngine.getRegionalPrograms(plot, topCrop, tel);

    this.renderWeatherAndSoilCard(tel, plot, lang);
    this.render7DayTelemetryChart(tel.weather.chart7Day);
    this.renderCropRecommendationsCard(this.evaluatedCrops, plot, lang);
    this.renderSeedCalculatorCard(seedPlan, topCrop, lang);
    this.renderMandiArbitrageCard(mandiArb, topCrop, lang);
    this.renderStorageArbitrageCard(storageList, topCrop, lotSizeQtl, lang);
    this.renderContractFarmingCard(regionalPrograms.contracts, lang);
    this.renderSchemesAndDroneCard(regionalPrograms.schemes, regionalPrograms.chcs, plot, lang);

    this.currentAiContext = {
      plot,
      location: { village: plot.village, taluka: plot.taluka, district: plot.district },
      weather: tel.weather,
      soilChem: tel.soilChem,
      topCrop,
      allCrops: this.evaluatedCrops,
      seedPlan,
      mandiArb,
      bestMandi: mandiArb.rankedMandis[0],
      bestStorage: storageList[0],
      topScheme: regionalPrograms.schemes[0]
    };

    this.refreshIcons();

    if (refreshAi) {
      await this.triggerLiveAiSummary();
    }
  }

  // NEW: Interactive 7-Day Weather, Rain Probability & Root-Zone Moisture Chart.js Renderer
  render7DayTelemetryChart(chart7Day) {
    if (!window.Chart || !chart7Day) return;
    const canvas = document.getElementById('telemetry-7day-chart');
    if (!canvas) return;

    if (this.telemetryChart) {
      this.telemetryChart.destroy();
    }

    const datasets = [];

    if (this.chartMode === 'all' || this.chartMode === 'moisture') {
      datasets.push({
        type: 'line',
        label: 'मुळाशी ओलावा / Root Moisture (7-28cm %)',
        data: chart7Day.rootMoisturePct,
        borderColor: '#059669',
        backgroundColor: 'rgba(5, 150, 105, 0.12)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: '#059669',
        tension: 0.35,
        fill: true,
        yAxisID: 'yPct'
      });

      datasets.push({
        type: 'bar',
        label: 'पाऊस शक्यता / Rain Probability (%)',
        data: chart7Day.rainProbs,
        backgroundColor: 'rgba(59, 130, 246, 0.55)',
        borderColor: '#2563EB',
        borderWidth: 1,
        borderRadius: 5,
        maxBarThickness: 28,
        yAxisID: 'yPct'
      });
    }

    if (this.chartMode === 'all' || this.chartMode === 'temp') {
      datasets.push({
        type: 'line',
        label: 'कमाल तापमान / Max Temp (°C)',
        data: chart7Day.maxTemps,
        borderColor: '#D97706',
        backgroundColor: '#D97706',
        borderWidth: 2.2,
        borderDash: [4, 3],
        pointRadius: 3.5,
        tension: 0.3,
        yAxisID: 'yTemp'
      });
    }

    if (this.chartMode === 'temp') {
      datasets.push({
        type: 'line',
        label: 'किमान तापमान / Min Temp (°C)',
        data: chart7Day.minTemps,
        borderColor: '#0284C7',
        backgroundColor: '#0284C7',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        yAxisID: 'yTemp'
      });

      datasets.push({
        type: 'bar',
        label: 'बाष्पीभवन / Evapotranspiration ET0 (mm/d)',
        data: chart7Day.et0Series,
        backgroundColor: 'rgba(245, 158, 11, 0.35)',
        borderColor: '#B45309',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 24,
        yAxisID: 'yTemp'
      });
    }

    this.telemetryChart = new Chart(canvas, {
      data: {
        labels: chart7Day.labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 11, weight: '600' }
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, weight: '600' }, color: '#334155' }
          },
          yPct: {
            type: 'linear',
            display: this.chartMode !== 'temp',
            position: 'left',
            min: 0,
            max: 100,
            title: {
              display: true,
              text: 'ओलावा व पाऊस शक्यता (%)',
              font: { size: 10, weight: 'bold' },
              color: '#059669'
            },
            grid: { color: '#E2E8F0' }
          },
          yTemp: {
            type: 'linear',
            display: this.chartMode !== 'moisture',
            position: 'right',
            min: 0,
            max: 45,
            title: {
              display: true,
              text: 'तापमान (°C) / ET0 (mm)',
              font: { size: 10, weight: 'bold' },
              color: '#D97706'
            },
            grid: { drawOnChartArea: this.chartMode === 'temp' }
          }
        }
      }
    });
  }

  renderWeatherAndSoilCard(tel, plot, lang) {
    const { weather, soilChem } = tel;
    const sprayBadge = document.getElementById('spray-window-badge');

    if (weather.sprayWindowSafe) {
      sprayBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-300';
      sprayBadge.textContent = this.i18n.t('spray_safe');
    } else {
      sprayBadge.className = 'text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-50 text-red-900 border border-red-300';
      sprayBadge.textContent = this.i18n.t('spray_unsafe');
    }

    document.getElementById('weather-soil-grid').innerHTML = `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">${lang === 'en' ? 'Temperature & Wind' : 'सध्याचे तापमान व वारा'}</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">${weather.tempC}°C</p>
        <p class="text-xs font-medium text-slate-600 mt-1">पाऊस शक्यता: ${weather.rainProbPct}% | वारा: ${weather.windSpeedKmh} km/h</p>
      </div>
      <div class="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5">
        <p class="text-[11px] font-bold uppercase tracking-wider text-emerald-800">${lang === 'en' ? 'Root-Zone Moisture (7-28cm)' : 'मुळाशी ओलावा (7-28 cm)'}</p>
        <p class="text-2xl font-extrabold text-emerald-950 mt-1">${weather.moisturePctDisplay}% <span class="text-xs font-mono font-normal">(${weather.moisture7_28cm} m³/m³)</span></p>
        <p class="text-xs font-medium text-emerald-800 mt-1">${plot.hasIrrigation ? 'सिंचन उपलब्ध (बागायती)' : 'कोरडवाहू क्षेत्र (Rainfed)'}</p>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">${lang === 'en' ? 'Soil pH & Clay Fraction' : 'मातीचा सामू (pH) व प्रकार'}</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">pH ${soilChem.ph}</p>
        <p class="text-xs font-medium text-slate-600 mt-1">${lang === 'en' ? soilChem.soilTextureEn : soilChem.soilTextureMr}</p>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">${lang === 'en' ? 'Evapotranspiration (ET0)' : 'बाष्पीभवन (ET0) व नत्र'}</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">${weather.et0MmDay} <span class="text-sm font-semibold">mm/d</span></p>
        <p class="text-xs font-medium text-slate-600 mt-1">उपलब्ध नत्र (N): ${soilChem.nitrogenMgKg} mg/kg</p>
      </div>
    `;

    document.getElementById('technical-lab-drawer').innerHTML = `
      <div><strong>गाव / तालुका:</strong> ${plot.village}, ${plot.taluka}</div>
      <div><strong>अक्षांश/रेखांश:</strong> ${plot.lat}, ${plot.lon}</div>
      <div><strong>0-7cm ओलावा:</strong> ${weather.moisture0_7cm} m³/m³</div>
      <div><strong>7-28cm ओलावा:</strong> ${weather.moisture7_28cm} m³/m³</div>
      <div><strong>मातीचे तापमान:</strong> ${weather.soilTempC}°C</div>
      <div><strong>चिकणमाती (Clay):</strong> ${soilChem.clayPct}%</div>
      <div><strong>ENSO निर्देशांक:</strong> +${this.kb.climate_macro.oni_anomaly_c}°C</div>
      <div><strong>शेतकरी प्रवर्ग:</strong> ${plot.farmerCategory}</div>
    `;
  }

  renderCropRecommendationsCard(crops, plot, lang) {
    const macro = this.kb.climate_macro;
    document.getElementById('enso-macro-banner').textContent =
      `${macro.season_label} (${macro.enso_phase}): ` + (macro.advisory[lang] || macro.advisory.mr);

    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const top3 = crops.slice(0, 3);

    const container = document.getElementById('crop-recommendations-list');
    container.innerHTML = top3
      .map((crop, idx) => {
        const isSelected = idx === this.selectedCropIndex;
        const nameLocal = crop[`name_${lang}`] || crop.name_mr;
        const varietyLocal = crop.seed_info[`variety_${lang}`] || crop.seed_info.variety_mr;
        const resolvedImg = this.wikiImageCache[crop.crop_id] || crop.image_url;
        const fallbackSvg = this.buildOfflineCropSvg(crop.name_en);

        const riskBadge =
          crop.riskLevel === 'LOW'
            ? `<span class="bg-emerald-50 text-emerald-900 border border-emerald-300 text-[11px] font-bold px-2 py-0.5 rounded">कमी जोखीम (${crop.totalRiskPct}%)</span>`
            : crop.riskLevel === 'MEDIUM'
            ? `<span class="bg-amber-50 text-amber-900 border border-amber-300 text-[11px] font-bold px-2 py-0.5 rounded">मध्यम जोखीम (${crop.totalRiskPct}%)</span>`
            : `<span class="bg-red-50 text-red-900 border border-red-300 text-[11px] font-bold px-2 py-0.5 rounded">उच्च जोखीम (${crop.totalRiskPct}%)</span>`;

        return `
          <div data-crop-idx="${idx}" class="crop-select-card cursor-pointer rounded-xl border overflow-hidden transition-all flex flex-col justify-between ${
          isSelected
            ? 'border-[#0B3B24] ring-2 ring-[#0B3B24] bg-emerald-50/15 shadow-md'
            : 'border-slate-200 bg-white hover:border-slate-400'
        }">
            <div>
              <div class="relative h-36 bg-slate-800 overflow-hidden">
                <img data-crop-img="${crop.crop_id}" src="${resolvedImg}" alt="${crop.name_en}"
                     referrerpolicy="no-referrer" crossorigin="anonymous"
                     class="crop-photo-banner w-full h-full object-cover"
                     onerror="this.onerror=null;this.src='${fallbackSvg}';" />
                <div class="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent"></div>
                <div class="absolute top-2.5 left-2.5 bg-slate-900/90 text-amber-300 text-[11px] font-extrabold px-2.5 py-0.5 rounded-md">
                  #${idx + 1} • ${crop.suitabilityScore}% अनुकूल
                </div>
                <div class="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-white">
                  <span class="text-xs font-bold">${crop.season} • ${crop.duration_days} दिवस</span>
                  ${riskBadge}
                </div>
              </div>

              <div class="p-4">
                <h3 class="text-base font-extrabold text-slate-900">${nameLocal}</h3>
                <p class="text-xs font-medium text-slate-600 mt-0.5">${varietyLocal}</p>

                <div class="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                  <div class="flex justify-between">
                    <span class="text-slate-500">अपेक्षित उत्पादन / एकर:</span>
                    <span class="font-bold text-slate-900">${crop.dynamicYieldQtlAcre} क्विंटल</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-slate-500">लागवड खर्च / एकर:</span>
                    <span class="font-semibold text-slate-800">₹${fmt(crop.cultivation_cost_acre)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-slate-500">हवामान व सिंचन जोखीम वजावट:</span>
                    <span class="font-semibold text-red-700">-₹${fmt(crop.climateRiskDeduction)}</span>
                  </div>
                  <div class="flex justify-between items-center pt-2 border-t border-slate-200 text-sm">
                    <span class="font-bold text-slate-900">निव्वळ नफा / एकर:</span>
                    <span class="text-base font-extrabold text-emerald-800">₹${fmt(crop.riskAdjustedNetProfitAcre)}</span>
                  </div>
                  <div class="flex justify-between text-[11px] bg-slate-50 px-2 py-1 rounded border border-slate-200">
                    <span class="text-slate-600 font-medium">एकूण ${plot.plotAcres} एकर निव्वळ नफा:</span>
                    <span class="font-extrabold text-slate-900">₹${fmt(crop.totalPlotNetProfit)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="px-4 py-2 text-xs font-bold text-center border-t ${
              isSelected ? 'bg-[#0B3B24] text-white border-[#0B3B24]' : 'bg-slate-50 text-slate-700 border-slate-200'
            }">
              ${isSelected ? 'निवडलेले पीक (खालील बियाणे व मंडी गणनेसाठी सक्रिय)' : 'या पिकाचे बियाणे व मंडी नफा पाहण्यासाठी क्लिक करा'}
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.crop-select-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedCropIndex = Number(card.getAttribute('data-crop-idx'));
        this.renderFullDashboard(true);
      });
    });
  }

  renderSeedCalculatorCard(seedPlan, topCrop, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    document.getElementById('seed-calculator-box').innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            ${seedPlan.acres} एकर क्षेत्रासाठी बियाणे प्रमाण
          </span>
          <h3 class="text-xl font-extrabold text-slate-900 mt-1">
            ${seedPlan.totalSeedKg} kg — ${seedPlan.cropNameLocal}
          </h3>
          <p class="text-xs font-semibold text-slate-700 mt-1">शिफारस वाण: ${seedPlan.varietyLocal}</p>
          <p class="text-xs text-slate-600 mt-1.5">
            अंदाजे बियाणे खर्च: <strong>₹${fmt(seedPlan.totalSeedCost)}</strong> | दोन ओळीतील अंतर: <strong>${seedPlan.spacing}</strong>
          </p>
        </div>

        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            बीजप्रक्रिया आणि रासायनिक खत डोस (NPK)
          </span>
          <p class="text-xs text-slate-800 mt-1 leading-relaxed">${seedPlan.treatmentText}</p>
          <div class="text-xs font-bold text-emerald-950 mt-2 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
            खत मात्रा: ${seedPlan.npkSchedule}
          </div>
        </div>

        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-2.5">
          <div>
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              जवळचे अधिकृत बियाणे व कृषी सेवा केंद्र
            </span>
            <p class="text-sm font-bold text-slate-900 mt-1">${seedPlan.primaryShop.name}</p>
          </div>
          <div class="space-y-2">
            <a href="${seedPlan.whatsappUrl}" target="_blank" rel="noopener"
               class="block w-full text-center bg-[#0B3B24] hover:bg-emerald-900 text-white font-bold text-xs py-2.5 px-3 rounded-lg shadow-2xs">
              WhatsApp वर बियाणे चौकशी करा (${seedPlan.totalSeedKg} kg)
            </a>
            <div class="grid grid-cols-2 gap-2">
              <a href="${seedPlan.mahabeejUrl}" target="_blank" rel="noopener"
                 class="text-center bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-xs py-1.5 px-2 rounded-lg">
                महाबीज पोर्टल
              </a>
              <a href="${seedPlan.sathiUrl}" target="_blank" rel="noopener"
                 class="text-center bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold text-xs py-1.5 px-2 rounded-lg">
                SATHI टॅग तपासणी
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderMandiArbitrageCard(mandiArb, topCrop, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const cropNameLocal = topCrop[`name_${lang}`] || topCrop.name_mr;

    const rowsHtml = mandiArb.rankedMandis
      .map((m, idx) => {
        const isWinner = idx === 0;
        const mandiName = m[`name_${lang}`] || m.name_mr;
        return `
          <tr class="${isWinner ? 'bg-emerald-50/70 font-semibold' : 'border-t border-slate-200'}">
            <td class="py-2.5 px-3">
              ${isWinner ? '<span class="bg-[#0B3B24] text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded mr-1.5">सर्वोत्तम नफा #1</span>' : `#${idx + 1}`}
              <span class="text-slate-900">${mandiName}</span>
            </td>
            <td class="py-2.5 px-3 text-center">${m.roadKm} km</td>
            <td class="py-2.5 px-3 text-right">₹${fmt(m.modalPriceQtl)}/Qtl</td>
            <td class="py-2.5 px-3 text-right text-red-700">-₹${fmt(m.totalDeductions)} <span class="text-[11px] text-slate-500">(भाडे ₹${fmt(m.transportCost)} + हमाली ₹${fmt(m.hamaliCost)})</span></td>
            <td class="py-2.5 px-3 text-right text-sm font-extrabold ${isWinner ? 'text-emerald-900' : 'text-slate-900'}">
              ₹${fmt(m.netTakeHome)}
            </td>
          </tr>
        `;
      })
      .join('');

    document.getElementById('mandi-arbitrage-table-wrap').innerHTML = `
      <div class="mb-3 bg-emerald-50/80 border border-emerald-200 text-emerald-950 px-3.5 py-2 rounded-lg text-xs font-medium">
        <strong>${cropNameLocal} (${mandiArb.lotSizeQtl} क्विंटल)</strong> साठी <strong>${mandiArb.rankedMandis[0][`name_${lang}`] || mandiArb.rankedMandis[0].name_mr}</strong> निवडल्यास वाहतूक व हमाली खर्च वजा करून इतर बाजारापेक्षा <strong>+₹${fmt(mandiArb.extraArbitrageGain)} जास्त निव्वळ रक्कम</strong> मिळते.
      </div>
      <table class="w-full text-left border-collapse text-xs sm:text-sm">
        <thead>
          <tr class="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold">
            <th class="py-2.5 px-3">कृषी उत्पन्न बाजार समिती (APMC)</th>
            <th class="py-2.5 px-3 text-center">रस्ता अंतर</th>
            <th class="py-2.5 px-3 text-right">सरासरी बाजारभाव</th>
            <th class="py-2.5 px-3 text-right">वाहतूक + हमाली वजावट</th>
            <th class="py-2.5 px-3 text-right">हातात पडणारी निव्वळ रक्कम</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  renderStorageArbitrageCard(storageList, topCrop, lotSizeQtl, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const top2 = storageList.slice(0, 2);

    document.getElementById('storage-arbitrage-list').innerHTML = top2
      .map((fac) => {
        const facName = fac[`name_${lang}`] || fac.name_mr;
        return `
          <div class="border ${fac.matchesRecommendedCrop ? 'border-emerald-700 bg-emerald-50/15' : 'border-slate-200 bg-white'} rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="bg-slate-800 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded">
                  ${fac.roadKm} km • ${fac.facility_type.replace('_', ' ')}
                </span>
                ${
                  fac.supports_pledge_loan
                    ? `<span class="bg-emerald-50 text-emerald-900 border border-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded">${fac.pledge_loan_ltv_pct}% शेतमाल तारण कर्ज</span>`
                    : ''
                }
              </div>
              <h3 class="text-base font-bold text-slate-900 mt-2">${facName}</h3>
              <p class="text-xs text-slate-600 mt-0.5">
                भाडे: ₹${fac.rent_per_qtl_month}/क्विंटल/महिना | ३ महिन्यांचे भाडे (${lotSizeQtl} Qtl): ₹${fmt(fac.storageRentTotal)}
              </p>

              <div class="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 text-xs">
                ${
                  fac.supports_pledge_loan
                    ? `<p class="text-slate-800"><strong>तात्काळ ७५% तारण कर्ज:</strong> माल ठेवताच <strong>₹${fmt(fac.immediatePledgeLoanCash)}</strong> बँक खात्यात उपलब्ध (${fac.pledge_interest_pct}% व्याजदर).</p>`
                    : ''
                }
                <p class="text-slate-800">
                  <strong>९० दिवस साठवणूक निव्वळ फायदा:</strong> भाडे व व्याज वजा करून अंदाजे <strong>+₹${fmt(fac.netExtraGainAfterRentAndInterest)}</strong> अतिरिक्त नफा.
                </p>
              </div>
            </div>

            <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
              <a href="tel:${fac.contact_phone}" class="text-emerald-800 hover:underline">संपर्क: ${fac.contact_phone}</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${fac.lat},${fac.lon}" target="_blank" rel="noopener"
                 class="bg-slate-900 text-white px-3 py-1 rounded-lg text-[11px]">Google Maps मार्ग</a>
            </div>
          </div>
        `;
      })
      .join('');
  }

  renderContractFarmingCard(contracts, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    document.getElementById('contract-farming-list').innerHTML = contracts
      .map((c) => {
        const orgName = c[`sponsor_org_${lang}`] || c.sponsor_org_mr;
        return `
          <div class="border border-slate-200 rounded-xl p-4 bg-slate-50/70 flex flex-col justify-between">
            <div>
              <span class="inline-block bg-emerald-50 text-emerald-900 border border-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded">
                +${c.market_premium_pct}% हमीभाव प्रीमियम
              </span>
              <h3 class="text-sm font-bold text-slate-900 mt-2">${orgName}</h3>
              <p class="text-xs text-slate-600 mt-0.5">वाण: ${c.required_variety}</p>
              <p class="text-base font-extrabold text-emerald-900 mt-2">
                हमीभाव दर: ₹${fmt(c.guaranteed_floor_price_qtl)} / क्विंटल
              </p>
              <p class="text-[11px] text-slate-500 mt-1">
                किमान क्षेत्र: ${c.min_acreage} एकर | अंतिम तारीख: ${c.registration_deadline}
              </p>
            </div>
            <a href="${c.apply_url}" target="_blank" rel="noopener"
               class="mt-3 block text-center bg-[#0B3B24] hover:bg-emerald-900 text-white font-semibold text-xs py-2 px-3 rounded-lg">
              करार अटी व नोंदणी पहा
            </a>
          </div>
        `;
      })
      .join('');
  }

  renderSchemesAndDroneCard(schemes, chcs, plot, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const hectares = (Number(plot.plotAcres || 2.5) * 0.404686).toFixed(2);

    const summaryEl = document.getElementById('scheme-profile-summary');
    if (summaryEl) {
      summaryEl.textContent = `गणना आधार: ${plot.plotAcres} एकर (${hectares} Ha) • प्रवर्ग: ${plot.farmerCategory || 'General'} • सिंचन: ${
        plot.hasIrrigation ? 'बागायती' : 'कोरडवाहू'
      } • तालुका: ${plot.taluka}`;
    }

    document.getElementById('gov-schemes-list').innerHTML = schemes
      .map((s) => {
        const title = s[`title_${lang}`] || s.title_mr;
        const calcNote = lang === 'en' ? s.calculationNoteEn : s.calculationNoteMr;
        const docs = (s[`documents_${lang}`] || s.documents_mr || []).join(' • ');
        const estProjectCost =
          s.subsidyPct < 100
            ? Math.round(s.estimatedSubsidyINR / (s.subsidyPct / 100))
            : s.estimatedSubsidyINR;
        const farmerShare = Math.max(0, estProjectCost - s.estimatedSubsidyINR);

        return `
          <div class="border border-slate-200 rounded-xl p-4 bg-white hover:border-emerald-600/60 transition-all">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div class="space-y-1 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="bg-slate-900 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded">${s.level}</span>
                  <span class="bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold px-2.5 py-0.5 rounded">
                    ${s.subsidyPct}% अनुदान • थेट लाभ: ₹${fmt(s.estimatedSubsidyINR)}
                  </span>
                </div>
                <h3 class="text-sm sm:text-base font-bold text-slate-900 pt-0.5">${title}</h3>
                <p class="text-xs font-medium text-slate-700">${calcNote}</p>
              </div>

              <a href="${s.apply_url}" target="_blank" rel="noopener"
                 class="shrink-0 bg-[#0B3B24] hover:bg-emerald-900 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-2xs">
                ऑनलाईन अर्ज करा ➔
              </a>
            </div>

            <div class="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs bg-slate-50 px-3 py-2 rounded-lg">
              <div>
                <span class="text-[10px] uppercase text-slate-500 block">अंदाजे प्रकल्प खर्च</span>
                <span class="font-bold text-slate-800">₹${fmt(estProjectCost)}</span>
              </div>
              <div>
                <span class="text-[10px] uppercase text-emerald-800 block">मिळणारे सरकारी अनुदान</span>
                <span class="font-extrabold text-emerald-800">₹${fmt(s.estimatedSubsidyINR)} (${s.subsidyPct}%)</span>
              </div>
              <div>
                <span class="text-[10px] uppercase text-slate-500 block">शेतकरी स्वहिस्सा</span>
                <span class="font-bold text-slate-900">₹${fmt(farmerShare)}</span>
              </div>
            </div>

            <p class="text-[11px] text-slate-500 mt-2">
              <strong>आवश्यक कागदपत्रे:</strong> ${docs}
            </p>
          </div>
        `;
      })
      .join('');

    document.getElementById('chc-drone-list').innerHTML = chcs
      .map(
        (c) => `
        <div class="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 space-y-1.5">
          <span class="text-[11px] font-bold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded">${c.roadKm} km अंतर</span>
          <h3 class="text-xs sm:text-sm font-bold text-slate-900 mt-1">${lang === 'en' ? c.name_en : c.name_mr}</h3>
          <p class="text-xs text-slate-700">
            ड्रोन फवारणी: <strong>₹${c.drone_spray_rate_acre}/एकर</strong> | हार्वेस्टर: <strong>₹${c.harvester_rate_hour}/तास</strong>
          </p>
          <a href="tel:${c.phone}" class="inline-block text-xs font-bold text-emerald-800 hover:underline">संपर्क: ${c.phone}</a>
        </div>
      `
      )
      .join('');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new KisanUnnatiApp();
  app.boot();
});