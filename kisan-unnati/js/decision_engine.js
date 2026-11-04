// ============================================================================
// js/decision_engine.js — Core Mathematical & Arbitrage Decision Engine
// Computes:
//   1. Haversine Geodesic + Road Winding Distance (1.28x)
//   2. El Nino & Soil Moisture Risk-Adjusted Net Profit per Acre
//   3. Precision Seed Rate, Bio-Treatment & 1-Tap WhatsApp Agro Order
//   4. Inter-Mandi Net Payout Arbitrage (Gross Modal - Freight - Hamali)
//   5. Cold Storage / Onion Chawl / MSWC 75% Pledge Loan Arbitrage
//   6. Contract Farming & Government Scheme Regional Eligibility
// ============================================================================

export class AgriculturalDecisionEngine {
  constructor(knowledgeBase, mandiData) {
    this.kb = knowledgeBase;
    this.mandiData = mandiData;
  }

  // Haversine Geodesic Distance with 1.28x Road Winding Multiplier
  calculateRoadDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;
    const roadFactor = this.mandiData?.freight_rates?.road_winding_factor || 1.28;
    return Math.max(2.0, Number((straightKm * roadFactor).toFixed(1)));
  }

  // MODULE 5 & 6: Multi-Factor Crop Suitability + El Nino Risk-Adjusted Profit
  evaluateCropsForPlot(plot, telemetry) {
    const { weather, soilChem } = telemetry;
    const macro = this.kb.climate_macro;
    const hasIrrigation = plot.hasIrrigation !== false;

    const evaluated = this.kb.crops.map((crop) => {
      // 1. Soil pH Compatibility Score
      const phFit =
        soilChem.ph >= crop.min_ph && soilChem.ph <= crop.max_ph ? 1.0 : 0.82;

      // 2. Sub-Surface Root Moisture Deficit Risk (7-28cm)
      const moistureDiff = weather.moisture7_28cm - crop.min_moisture_m3;
      let moistureRisk = 0.05;
      if (moistureDiff < 0) {
        moistureRisk = hasIrrigation ? Math.min(0.22, Math.abs(moistureDiff) * 1.4) : Math.min(0.45, Math.abs(moistureDiff) * 2.5);
      }

      // 3. El Nino (ENSO) & Evapotranspiration Risk Penalty
      const ensoRisk = crop.enso_drought_sensitivity * (macro.drought_penalty_weight * 1.35);
      const rainUnseasonalRisk = (weather.avg7DayRainProb / 100) * macro.unseasonal_rain_weight;

      // 4. Composite Total Risk Score R_total in [0.08, 0.55]
      const rawTotalRisk =
        0.35 * ensoRisk +
        0.35 * moistureRisk +
        0.20 * crop.price_volatility_cv +
        0.10 * rainUnseasonalRisk;

      const totalRiskPct = Math.min(52, Math.max(9, Math.round(rawTotalRisk * 100)));

      // 5. Financial Calculation per Acre
      const grossRevenueAcre = Math.round(crop.expected_yield_qtl_acre * crop.base_mandi_price_qtl * phFit);
      const climateRiskDeduction = Math.round(grossRevenueAcre * (totalRiskPct / 100) * 0.45);
      const riskAdjustedNetProfitAcre = grossRevenueAcre - crop.cultivation_cost_acre - climateRiskDeduction;

      // 6. Suitability Score (0 - 98%)
      const suitabilityScore = Math.min(
        98,
        Math.max(58, Math.round(100 - totalRiskPct * 0.65 - (1 - phFit) * 30))
      );

      // Risk Badge Tier
      let riskLevel = 'LOW';
      if (totalRiskPct >= 28) riskLevel = 'MEDIUM';
      if (totalRiskPct >= 40) riskLevel = 'HIGH';

      return {
        ...crop,
        suitabilityScore,
        totalRiskPct,
        riskLevel,
        grossRevenueAcre,
        climateRiskDeduction,
        riskAdjustedNetProfitAcre,
        totalPlotNetProfit: Math.round(riskAdjustedNetProfitAcre * (plot.plotAcres || 2.5))
      };
    });

    // Sort by highest Suitability Score + Risk-Adjusted Safety Balance
    return evaluated.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
  }

  // MODULE 7: Precision Seed Rate, Bio-Treatment & Krishi Seva Kendra WhatsApp Order
  calculateSeedOrderPlan(topCrop, plot, agroShops, lang = 'mr') {
    const acres = Number(plot.plotAcres || 2.5);
    const seedInfo = topCrop.seed_info;
    const totalSeedKg = Number((seedInfo.seed_rate_kg_acre * acres).toFixed(1));
    const totalSeedCost = Math.round(totalSeedKg * seedInfo.seed_cost_per_kg);

    // Bio-treatment quantities scaled to total seed weight
    const trichodermaGrams = Math.round(totalSeedKg * 5);
    const rhizobiumGrams = Math.round(totalSeedKg * 25);

    const primaryShop = (agroShops && agroShops[0]) || {
      name: `${plot.taluka} कृषी सेवा केंद्र (Mahabeej Dealer)`,
      phone: '9822011223'
    };

    const cropNameLocal = topCrop[`name_${lang}`] || topCrop.name_mr;
    const varietyLocal = seedInfo[`variety_${lang}`] || seedInfo.variety_mr;

    const waMessage =
      lang === 'mr'
        ? `नमस्कार, मी ${plot.taluka} येथून शेतकरी बोलत आहे. मला ${acres} एकर शेतासाठी '${cropNameLocal}' (${varietyLocal}) चे ${totalSeedKg} किलो प्रमाणित (Certified) बियाणे आणि ट्रायकोडर्मा बीजप्रक्रिया औषध हवे आहे. उपलब्ध आहे का?`
        : lang === 'hi'
        ? `नमस्ते, मुझे ${acres} एकड़ खेत के लिए '${cropNameLocal}' (${varietyLocal}) का ${totalSeedKg} किलो प्रमाणित बीज और बीजोपचार दवा चाहिए। क्या उपलब्ध है?`
        : `Hello, I need ${totalSeedKg} kg certified seed of ${cropNameLocal} (${varietyLocal}) for ${acres} acres in ${plot.taluka}. Is stock available?`;

    const whatsappUrl = `https://wa.me/91${primaryShop.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(waMessage)}`;

    return {
      acres,
      cropNameLocal,
      varietyLocal,
      totalSeedKg,
      totalSeedCost,
      spacing: seedInfo.spacing,
      trichodermaGrams,
      rhizobiumGrams,
      treatmentText: seedInfo[`treatment_${lang}`] || seedInfo.treatment_mr,
      primaryShop,
      whatsappUrl,
      mahabeejUrl: 'https://www.mahabeej.com/',
      sathiUrl: 'https://seedtrace.gov.in/'
    };
  }

  // MODULE 11: Inter-Mandi Net Take-Home Arbitrage Engine
  calculateMandiArbitrage(cropId, plot, lotSizeQtl = 25, splitTempo = false) {
    const ratesConfig = this.mandiData.freight_rates;

    // Select vehicle rate per km based on farmer's lot size
    let vehiclePerKm = ratesConfig.pickup_bolero_25qtl_per_km;
    if (lotSizeQtl <= 15) vehiclePerKm = ratesConfig.mini_tempo_15qtl_per_km;
    if (lotSizeQtl >= 40) vehiclePerKm = ratesConfig.eicher_truck_60qtl_per_km;

    if (splitTempo) {
      vehiclePerKm = vehiclePerKm * 0.5; // 50% shared transport saving with neighbor
    }

    const comparisons = this.mandiData.mandis.map((mandi) => {
      const roadKm = this.calculateRoadDistanceKm(plot.lat, plot.lon, mandi.lat, mandi.lon);
      const cropRateObj = mandi.rates[cropId] || { modal: 4500, min: 4100, max: 4800 };
      const grossValue = Math.round(lotSizeQtl * cropRateObj.modal);

      // Round-trip freight + loading/unloading hamali + transit shrinkage (0.15% per 100km)
      const transportCost = Math.round(roadKm * vehiclePerKm);
      const hamaliCost = Math.round(lotSizeQtl * mandi.hamali_weighing_per_qtl);
      const shrinkageLoss = Math.round(grossValue * (roadKm / 100) * 0.0018);

      const totalDeductions = transportCost + hamaliCost + shrinkageLoss;
      const netTakeHome = grossValue - totalDeductions;
      const netPerQtl = Math.round(netTakeHome / lotSizeQtl);

      return {
        mandiId: mandi.mandi_id,
        name_mr: mandi.name_mr,
        name_hi: mandi.name_hi,
        name_en: mandi.name_en,
        roadKm,
        modalPriceQtl: cropRateObj.modal,
        grossValue,
        transportCost,
        hamaliCost,
        totalDeductions,
        netTakeHome,
        netPerQtl
      };
    });

    // Sort by Highest Net Take-Home Payout (True Arbitrage Winner)
    comparisons.sort((a, b) => b.netTakeHome - a.netTakeHome);

    const bestNet = comparisons[0]?.netTakeHome || 0;
    const localNet = comparisons[comparisons.length - 1]?.netTakeHome || 0;

    return {
      lotSizeQtl,
      extraArbitrageGain: Math.max(0, bestNet - localNet),
      rankedMandis: comparisons
    };
  }

  // MODULE 9: Nearest Cold Storage, Onion Chawl & 75% Pledge Loan Arbitrage
  evaluateStorageOptions(plot, topCrop, lotSizeQtl = 25) {
    const holdMonths = 3;

    const facilities = this.kb.storage_facilities.map((fac) => {
      const roadKm = this.calculateRoadDistanceKm(plot.lat, plot.lon, fac.lat, fac.lon);
      const storageRentTotal = Math.round(fac.rent_per_qtl_month * holdMonths * lotSizeQtl);
      const grossPriceGain = Math.round(fac.expected_90d_price_gain_qtl * lotSizeQtl);

      // Immediate 75% Warehouse Receipt Pledge Loan Calculation
      const currentCropValue = lotSizeQtl * topCrop.base_mandi_price_qtl;
      const immediatePledgeLoanCash = fac.supports_pledge_loan
        ? Math.round(currentCropValue * (fac.pledge_loan_ltv_pct / 100))
        : 0;
      const pledgeInterest3Months = fac.supports_pledge_loan
        ? Math.round(immediatePledgeLoanCash * (fac.pledge_interest_pct / 100) * (3 / 12))
        : 0;

      const netExtraGainAfterRentAndInterest =
        grossPriceGain - storageRentTotal - pledgeInterest3Months;

      const matchesRecommendedCrop = fac.facility_type === topCrop.storage_type_needed;

      return {
        ...fac,
        roadKm,
        holdMonths,
        storageRentTotal,
        immediatePledgeLoanCash,
        pledgeInterest3Months,
        netExtraGainAfterRentAndInterest,
        matchesRecommendedCrop
      };
    });

    // Prioritize matching storage type & shortest distance
    return facilities.sort((a, b) => {
      if (a.matchesRecommendedCrop !== b.matchesRecommendedCrop) {
        return a.matchesRecommendedCrop ? -1 : 1;
      }
      return a.roadKm - b.roadKm;
    });
  }

  // MODULE 12 & 7: Filter Contract Farming, Gov Schemes & Custom Hiring Centres
  getRegionalPrograms(plot) {
    const dist = (plot.district || 'Pune').toLowerCase();

    const contracts = this.kb.contract_farming_offers.filter((c) =>
      c.eligible_districts.some((d) => d.toLowerCase() === dist || d === 'ALL')
    );

    const schemes = this.kb.gov_schemes.filter((s) =>
      s.eligible_districts.some((d) => d.toLowerCase() === dist || d === 'ALL')
    );

    const chcs = this.kb.custom_hiring_centres.map((chc) => ({
      ...chc,
      roadKm: this.calculateRoadDistanceKm(plot.lat, plot.lon, chc.lat, chc.lon)
    })).sort((a, b) => a.roadKm - b.roadKm);

    return {
      contracts: contracts.length ? contracts : this.kb.contract_farming_offers,
      schemes,
      chcs
    };
  }
}