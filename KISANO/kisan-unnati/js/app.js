// ============================================================================
// js/app.js — Main Application Controller for Kisan Unnati
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
  }

  async boot() {
    this.registerServiceWorker();

    // 1. Load static JSON knowledge base & Mandi snapshot
    const [kbRes, mandiRes] = await Promise.all([
      fetch('./data/agri_knowledge_base.json'),
      fetch('./data/mandi_latest.json')
    ]);
    this.kb = await kbRes.json();
    this.mandiData = await mandiRes.json();

    this.decisionEngine = new AgriculturalDecisionEngine(this.kb, this.mandiData);

    // 2. Initialize Auto-Local Language Engine (Top-Right Switcher)
    await this.i18n.init(() => {
      if (this.activePlot && this.activeTelemetry) {
        this.renderFullDashboard();
      }
    });

    // 3. Bind Mandi Lot-Size & Shared Tempo Pooling controls
    document.getElementById('input-mandi-lot-qtl')?.addEventListener('input', () => {
      if (this.activePlot && this.activeTelemetry) this.renderFullDashboard();
    });
    document.getElementById('chk-shared-tempo')?.addEventListener('change', () => {
      if (this.activePlot && this.activeTelemetry) this.renderFullDashboard();
    });

    // 4. Initialize "Are You at Your Farmland?" Geolocation & Satellite Map Manager
    this.geoManager = new FarmlandGeolocationManager(
      this.kb.taluka_directory,
      this.i18n,
      async (confirmedPlot) => {
        await this.loadPlotAndCompute(confirmedPlot);
      }
    );
    this.geoManager.init();
  }

  async loadPlotAndCompute(plot) {
    this.activePlot = plot;
    this.selectedCropIndex = 0;

    // Fetch live Open-Meteo, SoilGrids, Nominatim & Overpass OSM in parallel
    this.activeTelemetry = await this.telemetryFetcher.fetchAllPlotTelemetry(plot);

    // Merge resolved district/taluka back into activePlot
    this.activePlot.village = this.activeTelemetry.locationInfo.village;
    this.activePlot.taluka = this.activeTelemetry.locationInfo.taluka;
    this.activePlot.district = this.activeTelemetry.locationInfo.district;

    // Stage 2 Auto-Localization check based on resolved GPS State
    this.i18n.autoSwitchByDetectedState(this.activeTelemetry.locationInfo.state);

    // Run Crop Suitability & El Nino Risk-Adjusted Profit Engine
    this.evaluatedCrops = this.decisionEngine.evaluateCropsForPlot(
      this.activePlot,
      this.activeTelemetry
    );

    await this.renderFullDashboard();
  }

  async renderFullDashboard() {
    const lang = this.i18n.currentLang;
    const plot = this.activePlot;
    const tel = this.activeTelemetry;
    const topCrop = this.evaluatedCrops[this.selectedCropIndex] || this.evaluatedCrops[0];

    const lotSizeQtl = parseFloat(document.getElementById('input-mandi-lot-qtl')?.value) || 25;
    const splitTempo = document.getElementById('chk-shared-tempo')?.checked || false;

    // Update Top Navbar Location Badge & E-Peek Alert Banner
    const navBadge = document.getElementById('nav-location-badge');
    if (navBadge) {
      navBadge.textContent = `${tel.locationInfo.village}, ${tel.locationInfo.taluka} (${tel.locationInfo.district})`;
    }

    const ePeekText = document.getElementById('e-peek-text');
    if (ePeekText) {
      ePeekText.textContent = this.kb.climate_macro.e_peek_pahani_alert[lang] || this.kb.climate_macro.e_peek_pahani_alert.mr;
    }

    const gpsPill = document.getElementById('gps-mode-pill');
    if (gpsPill) {
      gpsPill.textContent = plot.isOnFieldGps
        ? `🛰️ ON-FARM GPS (±${plot.accuracy}m)`
        : `🗺️ SATELLITE PIN (${plot.lat}, ${plot.lon})`;
    }

    // Compute dependent engines for the currently selected crop
    const seedPlan = this.decisionEngine.calculateSeedOrderPlan(
      topCrop,
      plot,
      tel.agroShops,
      lang
    );
    const mandiArb = this.decisionEngine.calculateMandiArbitrage(
      topCrop.crop_id,
      plot,
      lotSizeQtl,
      splitTempo
    );
    const storageList = this.decisionEngine.evaluateStorageOptions(
      plot,
      topCrop,
      lotSizeQtl
    );
    const regionalPrograms = this.decisionEngine.getRegionalPrograms(plot);

    // Render all sections
    this.renderWeatherAndSoilCard(tel, plot, lang);
    this.renderCropRecommendationsCard(this.evaluatedCrops, lang);
    this.renderSeedCalculatorCard(seedPlan, topCrop, lang);
    this.renderMandiArbitrageCard(mandiArb, topCrop, lang);
    this.renderStorageArbitrageCard(storageList, topCrop, lotSizeQtl, lang);
    this.renderContractFarmingCard(regionalPrograms.contracts, lang);
    this.renderSchemesAndDroneCard(regionalPrograms.schemes, regionalPrograms.chcs, lang);

    // Render Card 1: Chrome Built-in AI ("Krishi-Mitra") Executive Summary
    const aiResult = await this.aiAdvisor.generateExecutiveAdvisory(
      {
        plot,
        location: tel.locationInfo,
        weather: tel.weather,
        soilChem: tel.soilChem,
        topCrop,
        seedPlan,
        mandiArb,
        bestMandi: mandiArb.rankedMandis[0],
        bestStorage: storageList[0]
      },
      lang
    );

    document.getElementById('ai-tier-badge').textContent = aiResult.tierBadge;
    document.getElementById('ai-advisory-content').innerHTML = aiResult.html;
  }

  // CARD 2: Weather, Soil Moisture & Safe Spray Window
  renderWeatherAndSoilCard(tel, plot, lang) {
    const { weather, soilChem } = tel;
    const sprayBadge = document.getElementById('spray-window-badge');

    if (weather.sprayWindowSafe) {
      sprayBadge.className = 'text-xs sm:text-sm font-extrabold px-3 py-1 rounded-full bg-green-100 text-green-900 border border-green-500';
      sprayBadge.textContent = this.i18n.t('spray_safe');
    } else {
      sprayBadge.className = 'text-xs sm:text-sm font-extrabold px-3 py-1 rounded-full bg-red-100 text-red-900 border border-red-500';
      sprayBadge.textContent = this.i18n.t('spray_unsafe');
    }

    const labels = {
      mr: {
        t1: 'तापमान व पाऊस शक्यता',
        t1Sub: `पाऊस शक्यता: ${weather.rainProbPct}% | वारा: ${weather.windSpeedKmh} km/h`,
        t2: 'मुळाशी ओलावा (7-28 cm)',
        t2Sub: weather.moisturePctDisplay >= 50 ? '🟢 पेरणी व वाढीसाठी उत्तम ओलावा' : '🟠 हलके पाणी देण्याची गरज',
        t3: 'मातीचा सामू (Soil pH) व प्रकार',
        t3Sub: soilChem.soilTextureMr,
        t4: 'बाष्पीभवन (ET0) व नत्र (N)',
        t4Sub: `उपलब्ध नत्र: ${soilChem.nitrogenMgKg} mg/kg`
      },
      hi: {
        t1: 'तापमान और बारिश संभावना',
        t1Sub: `बारिश: ${weather.rainProbPct}% | हवा: ${weather.windSpeedKmh} km/h`,
        t2: 'जड़ में नमी (7-28 cm)',
        t2Sub: weather.moisturePctDisplay >= 50 ? '🟢 बुवाई के लिए पर्याप्त नमी' : '🟠 हल्की सिंचाई आवश्यक',
        t3: 'मिट्टी का pH और प्रकार',
        t3Sub: soilChem.soilTextureHi,
        t4: 'वाष्पीकरण (ET0) व नाइट्रोजन',
        t4Sub: `नाइट्रोजन: ${soilChem.nitrogenMgKg} mg/kg`
      },
      en: {
        t1: 'Temperature & Rain Risk',
        t1Sub: `Rain Prob: ${weather.rainProbPct}% | Wind: ${weather.windSpeedKmh} km/h`,
        t2: 'Root-Zone Moisture (7-28 cm)',
        t2Sub: weather.moisturePctDisplay >= 50 ? '🟢 Optimal for germination' : '🟠 Supplemental irrigation advised',
        t3: 'Soil pH & Texture (SoilGrids)',
        t3Sub: soilChem.soilTextureEn,
        t4: 'Evapotranspiration (ET0) & N',
        t4Sub: `Available Nitrogen: ${soilChem.nitrogenMgKg} mg/kg`
      }
    }[lang];

    document.getElementById('weather-soil-grid').innerHTML = `
      <div class="bg-slate-50 border-2 border-slate-300 rounded-xl p-3.5">
        <p class="text-xs font-bold uppercase text-slate-600">${labels.t1}</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">🌡️ ${weather.tempC}°C</p>
        <p class="text-xs font-bold text-slate-700 mt-1">${labels.t1Sub}</p>
      </div>
      <div class="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-3.5">
        <p class="text-xs font-bold uppercase text-emerald-900">${labels.t2}</p>
        <p class="text-2xl font-extrabold text-emerald-950 mt-1">💧 ${weather.moisturePctDisplay}%</p>
        <p class="text-xs font-bold text-emerald-900 mt-1">${labels.t2Sub}</p>
      </div>
      <div class="bg-amber-50 border-2 border-amber-400 rounded-xl p-3.5">
        <p class="text-xs font-bold uppercase text-amber-900">${labels.t3}</p>
        <p class="text-2xl font-extrabold text-amber-950 mt-1">🧪 pH ${soilChem.ph}</p>
        <p class="text-xs font-bold text-amber-900 mt-1">${labels.t3Sub}</p>
      </div>
      <div class="bg-slate-50 border-2 border-slate-300 rounded-xl p-3.5">
        <p class="text-xs font-bold uppercase text-slate-600">${labels.t4}</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">☀️ ${weather.et0MmDay} mm/d</p>
        <p class="text-xs font-bold text-slate-700 mt-1">${labels.t4Sub}</p>
      </div>
    `;

    document.getElementById('technical-lab-drawer').innerHTML = `
      <div><strong>Lat/Lon:</strong> ${plot.lat}, ${plot.lon}</div>
      <div><strong>0-7cm Moisture:</strong> ${weather.moisture0_7cm} m³/m³</div>
      <div><strong>7-28cm Moisture:</strong> ${weather.moisture7_28cm} m³/m³</div>
      <div><strong>Soil Temp (0cm):</strong> ${weather.soilTempC}°C</div>
      <div><strong>Clay Content:</strong> ${soilChem.clayPct}%</div>
      <div><strong>ENSO Phase:</strong> ${this.kb.climate_macro.enso_phase}</div>
      <div><strong>ONI Anomaly:</strong> +${this.kb.climate_macro.oni_anomaly_c}°C</div>
      <div><strong>Agro Zone:</strong> ${plot.agroZone}</div>
    `;
  }

  // CARD 3: Top 3 Risk-Adjusted Profitable Crops
  renderCropRecommendationsCard(crops, lang) {
    const macro = this.kb.climate_macro;
    document.getElementById('enso-macro-banner').textContent =
      `🌍 ${macro.season_label} (${macro.enso_phase}): ` + (macro.advisory[lang] || macro.advisory.mr);

    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const top3 = crops.slice(0, 3);

    const container = document.getElementById('crop-recommendations-list');
    container.innerHTML = top3
      .map((crop, idx) => {
        const isSelected = idx === this.selectedCropIndex;
        const nameLocal = crop[`name_${lang}`] || crop.name_mr;
        const varietyLocal = crop.seed_info[`variety_${lang}`] || crop.seed_info.variety_mr;

        const riskBadge =
          crop.riskLevel === 'LOW'
            ? `<span class="bg-green-100 text-green-900 border border-green-500 text-xs font-extrabold px-2.5 py-0.5 rounded-full">🟢 कमी जोखीम (${crop.totalRiskPct}% Risk)</span>`
            : `<span class="bg-amber-100 text-amber-900 border border-amber-500 text-xs font-extrabold px-2.5 py-0.5 rounded-full">🟠 मध्यम जोखीम (${crop.totalRiskPct}% Risk)</span>`;

        return `
          <div data-crop-idx="${idx}" class="crop-select-card cursor-pointer rounded-xl p-4 border-2 transition-all ${
          isSelected
            ? 'border-green-800 bg-green-50/70 ring-2 ring-green-700'
            : 'border-slate-300 bg-white hover:border-green-600'
        }">
            <div class="flex items-start justify-between gap-2">
              <span class="bg-green-900 text-yellow-300 text-xs font-extrabold px-2.5 py-1 rounded-lg">
                #${idx + 1} • ${crop.suitabilityScore}% Match
              </span>
              ${riskBadge}
            </div>

            <h3 class="text-xl font-extrabold text-slate-900 mt-2">${nameLocal}</h3>
            <p class="text-xs font-bold text-green-900 mt-0.5">🌱 ${varietyLocal}</p>

            <div class="mt-3 pt-3 border-t border-slate-200 space-y-1 text-sm">
              <div class="flex justify-between">
                <span class="text-slate-600 font-semibold">${lang === 'en' ? 'Expected Yield / Acre:' : 'अपेक्षित उत्पादन / एकर:'}</span>
                <span class="font-bold">${crop.expected_yield_qtl_acre} Qtl (${crop.duration_days}d)</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-600 font-semibold">${lang === 'en' ? 'Cultivation Cost / Acre:' : 'लागवड खर्च / एकर:'}</span>
                <span class="font-bold text-slate-800">₹${fmt(crop.cultivation_cost_acre)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-600 font-semibold">${lang === 'en' ? 'Climate Risk Deduction:' : 'हवामान जोखीम वजावट:'}</span>
                <span class="font-bold text-red-700">-₹${fmt(crop.climateRiskDeduction)}</span>
              </div>
              <div class="flex justify-between items-center pt-2 border-t border-slate-300 text-base">
                <span class="font-extrabold text-green-950">${lang === 'en' ? 'Safe Net Profit / Acre:' : 'सुरक्षित निव्वळ नफा / एकर:'}</span>
                <span class="text-lg font-extrabold text-green-800">₹${fmt(crop.riskAdjustedNetProfitAcre)}</span>
              </div>
            </div>

            <div class="mt-3 text-xs font-extrabold text-center py-1.5 rounded-lg ${
              isSelected ? 'bg-green-800 text-white' : 'bg-slate-100 text-slate-700'
            }">
              ${
                isSelected
                  ? lang === 'en'
                    ? '✓ Selected for Seed, Mandi & Storage Calculators below'
                    : '✓ खालील बियाणे, मंडी आणि गोदाम गणनेसाठी निवडले आहे'
                  : lang === 'en'
                  ? 'Tap to calculate Seed, Mandi & Storage for this crop'
                  : 'या पिकाचे बियाणे व मंडी नफा पाहण्यासाठी येथे टॅप करा'
              }
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.crop-select-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedCropIndex = Number(card.getAttribute('data-crop-idx'));
        this.renderFullDashboard();
      });
    });
  }

  // CARD 4: Seed Rate Calculator, Bio-Treatment & Krishi Seva Kendra Order
  renderSeedCalculatorCard(seedPlan, topCrop, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    document.getElementById('seed-calculator-box').innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div class="bg-green-50 border-2 border-green-500 rounded-xl p-4">
          <span class="text-xs font-extrabold uppercase text-green-900">
            ${lang === 'en' ? `Precision Seed Requirement (${seedPlan.acres} Acres)` : `${seedPlan.acres} एकर शेतासाठी अचूक बियाणे प्रमाण`}
          </span>
          <h3 class="text-2xl font-extrabold text-green-950 mt-1">
            ${seedPlan.totalSeedKg} kg — ${seedPlan.cropNameLocal}
          </h3>
          <p class="text-sm font-bold text-slate-800 mt-1">वाण (Variety): ${seedPlan.varietyLocal}</p>
          <p class="text-xs font-bold text-slate-600 mt-1">
            अंदाजे बियाणे खर्च: <strong>₹${fmt(seedPlan.totalSeedCost)}</strong> | दोन ओळीतील अंतर: <strong>${seedPlan.spacing}</strong>
          </p>
        </div>

        <div class="bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
          <span class="text-xs font-extrabold uppercase text-amber-900">
            🧪 ${lang === 'en' ? 'Mandatory Bio-Seed Treatment Formula' : 'पेरणीपूर्वी अत्यावश्यक बीजप्रक्रिया (मर रोग संरक्षण)'}
          </span>
          <p class="text-sm font-bold text-slate-900 mt-1.5">${seedPlan.treatmentText}</p>
          <p class="text-xs font-extrabold text-amber-950 mt-2 bg-white px-2.5 py-1 rounded border border-amber-300">
            एकूण आवश्यक डोस: ${seedPlan.trichodermaGrams}g Trichoderma + ${seedPlan.rhizobiumGrams}g Rhizobium/PSB
          </p>
        </div>

        <div class="bg-slate-50 border-2 border-slate-300 rounded-xl p-4 flex flex-col justify-between space-y-2.5">
          <div>
            <span class="text-xs font-extrabold uppercase text-slate-700">
              🏪 ${lang === 'en' ? 'Nearest Authorized Seed Dealer' : 'जवळचे अधिकृत बियाणे व कृषी सेवा केंद्र'}
            </span>
            <p class="text-sm font-extrabold text-slate-900 mt-1">${seedPlan.primaryShop.name}</p>
          </div>
          <div class="space-y-2">
            <a href="${seedPlan.whatsappUrl}" target="_blank" rel="noopener"
               class="block w-full text-center bg-green-700 hover:bg-green-800 text-white font-extrabold text-sm py-2.5 px-3 rounded-xl shadow">
              💬 WhatsApp वर बियाणे स्टॉक विचारा (${seedPlan.totalSeedKg} kg)
            </a>
            <div class="grid grid-cols-2 gap-2">
              <a href="${seedPlan.mahabeejUrl}" target="_blank" rel="noopener"
                 class="text-center bg-white hover:bg-slate-100 text-green-900 border border-green-700 font-bold text-xs py-1.5 px-2 rounded-lg">
                🌾 महाबीज पोर्टल
              </a>
              <a href="${seedPlan.sathiUrl}" target="_blank" rel="noopener"
                 class="text-center bg-white hover:bg-slate-100 text-slate-800 border border-slate-400 font-bold text-xs py-1.5 px-2 rounded-lg">
                🔍 SATHI टॅग तपासणी
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // CARD 5: Inter-Mandi Net Payout Arbitrage Table
  renderMandiArbitrageCard(mandiArb, topCrop, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const cropNameLocal = topCrop[`name_${lang}`] || topCrop.name_mr;

    const rowsHtml = mandiArb.rankedMandis
      .map((m, idx) => {
        const isWinner = idx === 0;
        const mandiName = m[`name_${lang}`] || m.name_mr;
        return `
          <tr class="${isWinner ? 'bg-green-50 font-bold' : 'border-t border-slate-200'}">
            <td class="py-3 px-3">
              ${isWinner ? '<span class="bg-green-800 text-yellow-300 text-xs px-2 py-0.5 rounded mr-1">सर्वोत्तम नफा #1</span>' : `#${idx + 1}`}
              <span class="text-slate-900">${mandiName}</span>
            </td>
            <td class="py-3 px-3 text-center">${m.roadKm} km</td>
            <td class="py-3 px-3 text-right">₹${fmt(m.modalPriceQtl)}/क्विं</td>
            <td class="py-3 px-3 text-right text-red-700">-₹${fmt(m.totalDeductions)} <span class="text-xs text-slate-500">(भाडे ₹${fmt(m.transportCost)} + हमाली ₹${fmt(m.hamaliCost)})</span></td>
            <td class="py-3 px-3 text-right text-lg font-extrabold ${isWinner ? 'text-green-800' : 'text-slate-900'}">
              ₹${fmt(m.netTakeHome)}
            </td>
          </tr>
        `;
      })
      .join('');

    document.getElementById('mandi-arbitrage-table-wrap').innerHTML = `
      <div class="mb-3 bg-emerald-50 border border-emerald-400 text-emerald-950 px-3.5 py-2 rounded-xl text-sm font-bold">
        💡 <strong>${cropNameLocal} (${mandiArb.lotSizeQtl} क्विंटल)</strong> साठी <strong>${mandiArb.rankedMandis[0][`name_${lang}`] || mandiArb.rankedMandis[0].name_mr}</strong> निवडल्यास वाहतूक व हमाली खर्च वजा करून तुम्हाला इतर बाजारपेठेपेक्षा <strong>+₹${fmt(mandiArb.extraArbitrageGain)} जास्त निव्वळ रक्कम</strong> मिळेल.
      </div>
      <table class="w-full text-left border-collapse text-sm">
        <thead>
          <tr class="bg-slate-100 text-slate-800 border-b-2 border-slate-300 font-extrabold">
            <th class="py-2.5 px-3">कृषी उत्पन्न बाजार समिती (APMC Mandi)</th>
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

  // CARD 6: Nearest Cold Storage, Onion Chawl & 75% Pledge Loan Arbitrage
  renderStorageArbitrageCard(storageList, topCrop, lotSizeQtl, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const top2 = storageList.slice(0, 2);

    document.getElementById('storage-arbitrage-list').innerHTML = top2
      .map((fac) => {
        const facName = fac[`name_${lang}`] || fac.name_mr;
        return `
          <div class="border-2 ${fac.matchesRecommendedCrop ? 'border-green-700 bg-green-50/40' : 'border-slate-300 bg-white'} rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="bg-green-900 text-white text-xs font-extrabold px-2.5 py-1 rounded-full">
                  📍 ${fac.roadKm} km • ${fac.facility_type.replace('_', ' ')}
                </span>
                ${
                  fac.supports_pledge_loan
                    ? `<span class="bg-amber-100 text-amber-950 border border-amber-500 text-xs font-extrabold px-2.5 py-0.5 rounded-full">🏦 ${fac.pledge_loan_ltv_pct}% तारण कर्ज उपलब्ध</span>`
                    : ''
                }
              </div>
              <h3 class="text-lg font-extrabold text-slate-900 mt-2">${facName}</h3>
              <p class="text-xs font-bold text-slate-600 mt-0.5">
                भाडे: ₹${fac.rent_per_qtl_month}/क्विंटल/महिना | ३ महिन्यांचे एकूण भाडे (${lotSizeQtl} Qtl): ₹${fmt(fac.storageRentTotal)}
              </p>

              <div class="mt-3 bg-white border border-slate-300 rounded-lg p-3 space-y-1 text-sm">
                ${
                  fac.supports_pledge_loan
                    ? `<p class="font-bold text-green-900">💳 <strong>तात्काळ ७५% शेतमाल तारण कर्ज:</strong> माल ठेवताच <strong>₹${fmt(fac.immediatePledgeLoanCash)}</strong> रोख बँक खात्यात (${fac.pledge_interest_pct}% व्याजदर).</p>`
                    : ''
                }
                <p class="font-bold text-slate-800">
                  📈 <strong>३ महिने साठवणूक निव्वळ फायदा:</strong> भाडे व व्याज वजा करून अंदाजे <strong>+₹${fmt(fac.netExtraGainAfterRentAndInterest)}</strong> जास्त नफा.
                </p>
              </div>
            </div>

            <div class="mt-3 pt-2 flex items-center justify-between text-xs font-extrabold">
              <a href="tel:${fac.contact_phone}" class="text-green-900 underline">📞 संपर्क: ${fac.contact_phone}</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${fac.lat},${fac.lon}" target="_blank" rel="noopener"
                 class="bg-slate-800 text-white px-3 py-1.5 rounded-lg">🗺️ Google Maps मार्ग</a>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // CARD 7: Verified Contract Farming & FPO Guaranteed Buyback Board
  renderContractFarmingCard(contracts, lang) {
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    document.getElementById('contract-farming-list').innerHTML = contracts
      .map((c) => {
        const orgName = c[`sponsor_org_${lang}`] || c.sponsor_org_mr;
        return `
          <div class="border-2 border-slate-300 rounded-xl p-4 bg-white flex flex-col justify-between">
            <div>
              <span class="inline-block bg-emerald-100 text-emerald-950 border border-emerald-500 text-xs font-extrabold px-2.5 py-0.5 rounded-full">
                +${c.market_premium_pct}% मार्केटपेक्षा जास्त हमीभाव
              </span>
              <h3 class="text-base font-extrabold text-slate-900 mt-2">${orgName}</h3>
              <p class="text-xs font-bold text-green-900 mt-1">वाण: ${c.required_variety}</p>
              <p class="text-xl font-extrabold text-green-800 mt-2">
                हमीभाव: ₹${fmt(c.guaranteed_floor_price_qtl)} / क्विंटल
              </p>
              <p class="text-xs text-slate-600 font-semibold mt-1">
                किमान क्षेत्र: ${c.min_acreage} एकर | अंतिम मुदत: ${c.registration_deadline}
              </p>
            </div>
            <a href="${c.apply_url}" target="_blank" rel="noopener"
               class="mt-3 block text-center bg-green-800 hover:bg-green-900 text-white font-bold text-xs py-2 px-3 rounded-lg">
              📝 करार नोंदणी व अटी पहा
            </a>
          </div>
        `;
      })
      .join('');
  }

  // CARD 8: Matched Government Schemes & Custom Hiring / Agri-Drone Centres
  renderSchemesAndDroneCard(schemes, chcs, lang) {
    document.getElementById('gov-schemes-list').innerHTML = schemes
      .map((s) => {
        const title = s[`title_${lang}`] || s.title_mr;
        const summary = s[`subsidy_summary_${lang}`] || s.subsidy_summary_mr;
        const docs = (s[`documents_${lang}`] || s.documents_mr || []).join(' • ');
        return `
          <div class="border-2 border-slate-300 rounded-xl p-3.5 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span class="bg-green-900 text-yellow-300 text-xs font-extrabold px-2 py-0.5 rounded">${s.level}</span>
              <h3 class="text-base font-extrabold text-slate-900 mt-1">${title}</h3>
              <p class="text-sm font-semibold text-slate-700 mt-0.5">${summary}</p>
              <p class="text-xs font-bold text-amber-900 mt-1">📋 आवश्यक कागदपत्रे: ${docs}</p>
            </div>
            <a href="${s.apply_url}" target="_blank" rel="noopener"
               class="shrink-0 bg-green-700 hover:bg-green-800 text-white font-extrabold text-xs px-3.5 py-2.5 rounded-xl shadow">
              थेट अर्ज करा ➔
            </a>
          </div>
        `;
      })
      .join('');

    document.getElementById('chc-drone-list').innerHTML = chcs
      .map(
        (c) => `
        <div class="border-2 border-slate-300 rounded-xl p-3.5 bg-white space-y-1.5">
          <span class="text-xs font-extrabold text-green-900 bg-green-100 px-2 py-0.5 rounded">📍 ${c.roadKm} km</span>
          <h3 class="text-sm font-extrabold text-slate-900">${lang === 'en' ? c.name_en : c.name_mr}</h3>
          <p class="text-xs font-bold text-slate-700">
            🚁 ड्रोन फवारणी: <strong>₹${c.drone_spray_rate_acre}/एकर</strong> | 🚜 हार्वेस्टर: <strong>₹${c.harvester_rate_hour}/तास</strong>
          </p>
          <a href="tel:${c.phone}" class="inline-block text-xs font-extrabold text-green-800 underline">📞 बुकिंग: ${c.phone}</a>
        </div>
      `
      )
      .join('');
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new KisanUnnatiApp();
  app.boot();
});