// ============================================================================
// js/decision_engine.js — Dynamic Agronomic Response & Subsidy Engine
// Upgrades:
//   1. Continuous Gaussian Temperature, Soil pH, Moisture & Irrigation Yield Model
//   2. Season Filtering (Rabi / Kharif / Annual / All)
//   3. Dynamic Government Scheme Rupee Calculator scaled by Plot Hectares,
//      Farmer Category (General / OBC / SC-ST), and Crop Selection
// ============================================================================

export class AgriculturalDecisionEngine {
  constructor(knowledgeBase, mandiData) {
    this.kb = knowledgeBase;
    this.mandiData = mandiData;
  }

  calculateRoadDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const roadFactor = this.mandiData?.freight_rates?.road_winding_factor || 1.28;
    return Math.max(2.0, Number((R * c * roadFactor).toFixed(1)));
  }

  // Dynamic Crop Evaluation using Continuous Agronomic Curves
  evaluateCropsForPlot(plot, telemetry, seasonFilter = 'ALL') {
    const { weather, soilChem } = telemetry;
    const macro = this.kb.climate_macro;
    const hasIrrigation = plot.hasIrrigation !== false;

    const candidateList =
      seasonFilter === 'ALL'
        ? this.kb.crops
        : this.kb.crops.filter((c) => c.season === seasonFilter || c.season === 'Annual');

    const evaluated = candidateList.map((crop) => {
      // 1. Continuous Soil pH Response Curve (0.65 to 1.02)
      const midPh = (crop.min_ph + crop.max_ph) / 2;
      const halfSpan = (crop.max_ph - crop.min_ph) / 2;
      const phDeviation = Math.abs(soilChem.ph - midPh);
      const phFactor =
        phDeviation <= halfSpan
          ? 1.02 - 0.05 * (phDeviation / halfSpan)
          : Math.max(0.68, 0.95 - (phDeviation - halfSpan) * 0.18);

      // 2. Live Temperature Gaussian Suitability Curve
      const tempDiff = Math.abs(weather.tempC - (crop.opt_temp_c || 25));
      const tol = crop.temp_tolerance_c || 8.5;
      const tempFactor = Math.max(0.65, Math.exp(-0.5 * (tempDiff / tol) ** 2));

      // 3. Root-Zone Moisture & Irrigation Factor
      let irrigationYieldMultiplier = 1.0;
      let moistureRisk = 0.06;

      if (!hasIrrigation) {
        irrigationYieldMultiplier = crop.rainfed_yield_factor || 0.6;
        if (crop.requires_irrigation) {
          moistureRisk += 0.28; // High risk if planting irrigated crop on dryland
        }
      }

      const moistureDeficit = crop.min_moisture_m3 - weather.moisture7_28cm;
      if (moistureDeficit > 0) {
        const deficitPenalty = hasIrrigation ? moistureDeficit * 0.9 : moistureDeficit * 2.2;
        moistureRisk += Math.min(0.25, deficitPenalty);
        irrigationYieldMultiplier *= Math.max(0.72, 1 - deficitPenalty * 0.5);
      }

      // 4. Composite Climate & Price Risk Score
      const ensoRisk = crop.enso_drought_sensitivity * (macro.drought_penalty_weight * 1.3);
      const et0Stress = Math.max(0, (weather.et0MmDay - 4.0) * 0.03);
      const rawTotalRisk =
        0.30 * ensoRisk +
        0.35 * moistureRisk +
        0.20 * crop.price_volatility_cv +
        0.15 * et0Stress;

      const totalRiskPct = Math.min(62, Math.max(8, Math.round(rawTotalRisk * 100)));

      // 5. Dynamic Expected Yield per Acre (adjusted by local Soil pH, Temp & Irrigation)
      const dynamicYieldQtlAcre = Number(
        (crop.expected_yield_qtl_acre * phFactor * tempFactor * irrigationYieldMultiplier).toFixed(1)
      );

      // 6. Live Local Mandi Modal Price Lookup
      const nearestMandis = this.mandiData.mandis || [];
      const localModalPrice =
        nearestMandis[0]?.rates?.[crop.crop_id]?.modal || crop.base_mandi_price_qtl;

      const grossRevenueAcre = Math.round(dynamicYieldQtlAcre * localModalPrice);
      const climateRiskDeduction = Math.round(grossRevenueAcre * (totalRiskPct / 100) * 0.42);
      const riskAdjustedNetProfitAcre =
        grossRevenueAcre - crop.cultivation_cost_acre - climateRiskDeduction;

      // 7. Composite Agronomic Suitability Score (0 - 98%)
      const suitabilityScore = Math.min(
        98,
        Math.max(
          42,
          Math.round(
            phFactor * 32 +
              tempFactor * 28 +
              irrigationYieldMultiplier * 25 +
              (1 - totalRiskPct / 100) * 15
          )
        )
      );

      let riskLevel = 'LOW';
      if (totalRiskPct >= 24) riskLevel = 'MEDIUM';
      if (totalRiskPct >= 38) riskLevel = 'HIGH';

      return {
        ...crop,
        dynamicYieldQtlAcre,
        localModalPrice,
        suitabilityScore,
        totalRiskPct,
        riskLevel,
        grossRevenueAcre,
        climateRiskDeduction,
        riskAdjustedNetProfitAcre,
        totalPlotNetProfit: Math.round(riskAdjustedNetProfitAcre * (plot.plotAcres || 2.5))
      };
    });

    // Rank by combination of Suitability Score and Positive Risk-Adjusted Return
    return evaluated.sort((a, b) => {
      const scoreA = a.suitabilityScore * 1000 + a.riskAdjustedNetProfitAcre * 0.25;
      const scoreB = b.suitabilityScore * 1000 + b.riskAdjustedNetProfitAcre * 0.25;
      return scoreB - scoreA;
    });
  }

  calculateSeedOrderPlan(topCrop, plot, agroShops, lang = 'mr') {
    const acres = Number(plot.plotAcres || 2.5);
    const seedInfo = topCrop.seed_info;
    const totalSeedKg = Number((seedInfo.seed_rate_kg_acre * acres).toFixed(1));
    const totalSeedCost = Math.round(totalSeedKg * seedInfo.seed_cost_per_kg);

    const trichodermaGrams = Math.round(totalSeedKg * 5);
    const rhizobiumGrams = Math.round(totalSeedKg * 25);

    const primaryShop = (agroShops && agroShops[0]) || {
      name: `${plot.taluka} तालुका कृषी सेवा केंद्र (Mahabeej Authorized)`,
      phone: '9822011223'
    };

    const cropNameLocal = topCrop[`name_${lang}`] || topCrop.name_mr;
    const varietyLocal = seedInfo[`variety_${lang}`] || seedInfo.variety_mr;

    const waMessage =
      lang === 'mr'
        ? `नमस्कार, मी ${plot.village} (ता. ${plot.taluka}) येथून बोलत आहे. मला ${acres} एकर शेतासाठी '${cropNameLocal}' (${varietyLocal}) चे ${totalSeedKg} किलो प्रमाणित बियाणे व बीजप्रक्रिया औषध हवे आहे. उपलब्ध आहे का?`
        : lang === 'hi'
        ? `नमस्ते, मुझे ${acres} एकड़ खेत के लिए '${cropNameLocal}' (${varietyLocal}) का ${totalSeedKg} किलो प्रमाणित बीज चाहिए। क्या उपलब्ध है?`
        : `Hello, I need ${totalSeedKg} kg certified seed of ${cropNameLocal} (${varietyLocal}) for ${acres} acres in ${plot.taluka}. Is stock available?`;

    const whatsappUrl = `https://wa.me/91${primaryShop.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(waMessage)}`;

    return {
      acres,
      cropNameLocal,
      varietyLocal,
      totalSeedKg,
      totalSeedCost,
      spacing: seedInfo.spacing,
      npkSchedule: topCrop.npk_kg_acre,
      trichodermaGrams,
      rhizobiumGrams,
      treatmentText: seedInfo[`treatment_${lang}`] || seedInfo.treatment_mr,
      primaryShop,
      whatsappUrl,
      mahabeejUrl: 'https://www.mahabeej.com/',
      sathiUrl: 'https://seedtrace.gov.in/'
    };
  }

  calculateMandiArbitrage(cropId, plot, lotSizeQtl = 25, splitTempo = false) {
    const ratesConfig = this.mandiData.freight_rates;
    let vehiclePerKm = ratesConfig.pickup_bolero_25qtl_per_km;
    if (lotSizeQtl <= 15) vehiclePerKm = ratesConfig.mini_tempo_15qtl_per_km;
    if (lotSizeQtl >= 40) vehiclePerKm = ratesConfig.eicher_truck_60qtl_per_km;
    if (splitTempo) vehiclePerKm *= 0.5;

    const comparisons = this.mandiData.mandis.map((mandi) => {
      const roadKm = this.calculateRoadDistanceKm(plot.lat, plot.lon, mandi.lat, mandi.lon);
      const cropRateObj = mandi.rates[cropId] || { modal: 4600, min: 4200, max: 4950 };
      const grossValue = Math.round(lotSizeQtl * cropRateObj.modal);

      const transportCost = Math.round(roadKm * vehiclePerKm);
      const hamaliCost = Math.round(lotSizeQtl * mandi.hamali_weighing_per_qtl);
      const shrinkageLoss = Math.round(grossValue * (roadKm / 100) * 0.0018);

      const totalDeductions = transportCost + hamaliCost + shrinkageLoss;
      const netTakeHome = grossValue - totalDeductions;

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
        netTakeHome
      };
    });

    comparisons.sort((a, b) => b.netTakeHome - a.netTakeHome);
    const bestNet = comparisons[0]?.netTakeHome || 0;
    const lowestNet = comparisons[comparisons.length - 1]?.netTakeHome || 0;

    return {
      lotSizeQtl,
      extraArbitrageGain: Math.max(0, bestNet - lowestNet),
      rankedMandis: comparisons
    };
  }

  evaluateStorageOptions(plot, topCrop, lotSizeQtl = 25) {
    const holdMonths = 3;
    const facilities = this.kb.storage_facilities.map((fac) => {
      const roadKm = this.calculateRoadDistanceKm(plot.lat, plot.lon, fac.lat, fac.lon);
      const storageRentTotal = Math.round(fac.rent_per_qtl_month * holdMonths * lotSizeQtl);
      const grossPriceGain = Math.round(fac.expected_90d_price_gain_qtl * lotSizeQtl);

      const currentCropValue = lotSizeQtl * topCrop.base_mandi_price_qtl;
      const immediatePledgeLoanCash = fac.supports_pledge_loan
        ? Math.round(currentCropValue * (fac.pledge_loan_ltv_pct / 100))
        : 0;
      const pledgeInterest3Months = fac.supports_pledge_loan
        ? Math.round(immediatePledgeLoanCash * (fac.pledge_interest_pct / 100) * 0.25)
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
        netExtraGainAfterRentAndInterest,
        matchesRecommendedCrop
      };
    });

    return facilities.sort((a, b) => {
      if (a.matchesRecommendedCrop !== b.matchesRecommendedCrop) {
        return a.matchesRecommendedCrop ? -1 : 1;
      }
      return a.roadKm - b.roadKm;
    });
  }

  // Dynamic Regional Schemes & Exact Rupee Subsidy Calculator
  getRegionalPrograms(plot, topCrop, telemetry) {
    const dist = (plot.district || 'Pune').toLowerCase();
    const acres = Number(plot.plotAcres || 2.5);
    const hectares = Number((acres * 0.404686).toFixed(2));
    const isSmallMarginal = hectares <= 2.0; // <= 5 Acres
    const category = plot.farmerCategory || 'General';

    const contracts = this.kb.contract_farming_offers.filter((c) =>
      c.eligible_districts.some((d) => d.toLowerCase() === dist || d === 'ALL')
    );

    // Dynamically calculate exact subsidy % and Rupee payout for each scheme
    const dynamicSchemes = this.kb.gov_schemes
      .filter((s) => s.eligible_districts.some((d) => d.toLowerCase() === dist || d === 'ALL'))
      .map((s) => {
        let subsidyPct = s.general_large_pct || 50;
        if (category === 'SC_ST') {
          subsidyPct = s.sc_st_pct || 85;
        } else if (isSmallMarginal || category === 'OBC') {
          subsidyPct = s.small_marginal_pct || 75;
        }

        const cappedAcres = Math.min(acres, 12.0);
        let estimatedSubsidyINR = 0;
        let calculationNoteMr = '';
        let calculationNoteEn = '';
        let priorityScore = 50;

        if (s.calc_type === 'PER_ACRE_IRRIGATION') {
          const totalProjectCost = Math.round(cappedAcres * s.base_cost_per_acre);
          estimatedSubsidyINR = Math.round(totalProjectCost * (subsidyPct / 100));
          calculationNoteMr = `${acres} एकर (${hectares} Ha) व ${category} प्रवर्गासाठी ${subsidyPct}% दराने अंदाजे ₹${estimatedSubsidyINR.toLocaleString('en-IN')} थेट ठिबक अनुदान.`;
          calculationNoteEn = `${subsidyPct}% subsidy for ${acres} acres (${hectares} Ha, ${category}): Est. grant INR ${estimatedSubsidyINR.toLocaleString('en-IN')}.`;
          if (!plot.hasIrrigation || telemetry?.weather?.moisturePctDisplay < 55) priorityScore += 35;
        } else if (s.calc_type === 'ONION_STORAGE_STRUCTURE') {
          const capacityNeededMt = Math.min(50, Math.max(25, Math.round((acres * 35) / 10)));
          const totalCost = capacityNeededMt * s.base_cost_per_mt;
          estimatedSubsidyINR = Math.round(totalCost * (subsidyPct / 100));
          calculationNoteMr = `${capacityNeededMt} मे.टन क्षमतेच्या कांदा चाळीसाठी ५०% दराने ₹${estimatedSubsidyINR.toLocaleString('en-IN')} अनुदान.`;
          calculationNoteEn = `50% grant for ${capacityNeededMt} MT Onion Storage Structure: INR ${estimatedSubsidyINR.toLocaleString('en-IN')}.`;
          if (topCrop.crop_id === 'rabi_onion') priorityScore += 45;
        } else if (s.calc_type === 'CLIMATE_RESILIENCE_GRANT') {
          estimatedSubsidyINR = Math.round(Math.min(acres, 5) * s.base_cost_per_acre * (subsidyPct / 100));
          calculationNoteMr = `हवामान अनुकूल शेती व शेततळे अस्तरीकरणासाठी ${subsidyPct}% दराने कमाल ₹${estimatedSubsidyINR.toLocaleString('en-IN')} अर्थसहाय्य.`;
          calculationNoteEn = `${subsidyPct}% climate-resilience grant for ${acres} acres: Up to INR ${estimatedSubsidyINR.toLocaleString('en-IN')}.`;
          if (!plot.hasIrrigation) priorityScore += 40;
        } else {
          estimatedSubsidyINR = s.fixed_annual_inr || 12000;
          subsidyPct = 100;
          calculationNoteMr = `केंद्र ₹६,००० + राज्य ₹६,००० असे वर्षाला थेट ₹${estimatedSubsidyINR.toLocaleString('en-IN')} बँक खात्यात जमा.`;
          calculationNoteEn = `Direct annual DBT payout of INR ${estimatedSubsidyINR.toLocaleString('en-IN')}/year.`;
        }

        return {
          ...s,
          subsidyPct,
          estimatedSubsidyINR,
          calculationNoteMr,
          calculationNoteEn,
          priorityScore
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);

    const chcs = this.kb.custom_hiring_centres
      .map((chc) => ({
        ...chc,
        roadKm: this.calculateRoadDistanceKm(plot.lat, plot.lon, chc.lat, chc.lon)
      }))
      .sort((a, b) => a.roadKm - b.roadKm);

    return {
      contracts: contracts.length ? contracts : this.kb.contract_farming_offers,
      schemes: dynamicSchemes,
      chcs
    };
  }
}