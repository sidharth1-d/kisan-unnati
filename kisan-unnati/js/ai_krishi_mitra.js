// ============================================================================
// js/ai_krishi_mitra.js — 3-Tier Zero-Key AI Router ("Krishi-Mitra")
// Tier 1: Chrome Built-in AI (Gemini Nano via self.LanguageModel / window.ai)
// Tier 2: Optional Local Daemon Bridge (127.0.0.1:11434)
// Tier 3: Instant Deterministic Multi-Language Rule Synthesizer (Mobile Safe)
// ============================================================================

export class KrishiMitraAI {
  async generateExecutiveAdvisory(context, lang = 'mr') {
    // 1. Try Chrome Built-in Gemini Nano (Zero-Key On-Device Prompt API)
    try {
      const nanoResult = await this.tryChromeGeminiNano(context, lang);
      if (nanoResult) {
        return {
          tierBadge: '⚡ Chrome Gemini Nano (On-Device AI)',
          html: nanoResult
        };
      }
    } catch (err) {
      console.warn('Chrome Gemini Nano fallback triggered:', err.message);
    }

    // 2. Try Optional Localhost AI Daemon (if toggled for local laptop demo)
    if (localStorage.getItem('kisan_use_local_daemon') === 'true') {
      try {
        const localRes = await this.tryLocalDaemon(context, lang);
        if (localRes) {
          return {
            tierBadge: '🖥️ Local AI Daemon (127.0.0.1)',
            html: localRes
          };
        }
      } catch (e) {
        console.warn('Local daemon unavailable, using rule synthesizer.');
      }
    }

    // 3. Tier 3: Instant Deterministic Multi-Language Synthesizer (0ms latency)
    return {
      tierBadge: '🧠 Krishi-Mitra Smart DSS Engine',
      html: this.buildDeterministicAdvisory(context, lang)
    };
  }

  async tryChromeGeminiNano(ctx, lang) {
    const langName = lang === 'mr' ? 'Marathi' : lang === 'hi' ? 'Hindi' : 'English';
    const systemPrompt =
      `You are Krishi-Mitra, an agricultural scientist and financial advisor for farmers in ${ctx.location.district}, Maharashtra. ` +
      `Respond strictly in ${langName} using 3 short bullet points covering: (1) Top profitable crop with El Nino risk, ` +
      `(2) Exact seed quantity & spray window, and (3) Best Mandi net payout vs Warehouse pledge loan.`;

    const userPrompt = JSON.stringify({
      location: `${ctx.location.village}, ${ctx.location.taluka} (${ctx.location.district})`,
      plotAcres: ctx.plot.plotAcres,
      soilMoisturePct: ctx.weather.moisturePctDisplay,
      soilPh: ctx.soilChem.ph,
      spraySafe: ctx.weather.sprayWindowSafe,
      topCrop: ctx.topCrop.name_en,
      netProfitPerAcreINR: ctx.topCrop.riskAdjustedNetProfitAcre,
      seedNeededKg: ctx.seedPlan.totalSeedKg,
      bestMandi: ctx.bestMandi.name_en,
      bestMandiNetTakeHomeINR: ctx.bestMandi.netTakeHome,
      storagePledgeLoanINR: ctx.bestStorage.immediatePledgeLoanCash
    });

    // Support Chrome 131+ self.LanguageModel API
    if ('LanguageModel' in self) {
      const availability = await self.LanguageModel.availability();
      if (availability === 'readily' || availability === 'after-download') {
        const session = await self.LanguageModel.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }]
        });
        const raw = await session.prompt(userPrompt);
        session.destroy?.();
        return this.formatBullets(raw);
      }
    }

    // Support Chrome 127-130 window.ai.languageModel API
    if (window.ai && window.ai.languageModel) {
      const caps = await window.ai.languageModel.capabilities();
      if (caps && caps.available === 'readily') {
        const session = await window.ai.languageModel.create({
          systemPrompt
        });
        const raw = await session.prompt(userPrompt);
        session.destroy?.();
        return this.formatBullets(raw);
      }
    }

    return null;
  }

  async tryLocalDaemon(ctx, lang) {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma2:2b',
        prompt: `Give 3 short bullet points in ${lang} for farmer in ${ctx.location.taluka}: Top crop ${ctx.topCrop.name_en} (Profit Rs ${ctx.topCrop.riskAdjustedNetProfitAcre}/acre), Best Mandi ${ctx.bestMandi.name_en}.`,
        stream: false
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return this.formatBullets(data.response);
  }

  formatBullets(text) {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return `<ul class="list-disc pl-5 space-y-1.5">${lines
      .map((l) => `<li>${l.replace(/^[\*\-\d\.]+\s*/, '')}</li>`)
      .join('')}</ul>`;
  }

  buildDeterministicAdvisory(ctx, lang) {
    const { plot, location, weather, soilChem, topCrop, seedPlan, bestMandi, mandiArb, bestStorage } = ctx;
    const fmt = (n) => Number(n).toLocaleString('en-IN');

    if (lang === 'mr') {
      return `
        <ul class="list-disc pl-5 space-y-1.5">
          <li><strong>🌱 सर्वोत्तम पीक व हवामान जोखीम (${location.taluka}, ${location.district}):</strong> तुमच्या शेतातील जमिनीचा सामू (<strong>pH ${soilChem.ph}</strong>) आणि <strong>${weather.moisturePctDisplay}%</strong> मुळाशी असलेला ओलावा पाहता <strong>${topCrop.name_mr} (${seedPlan.varietyLocal})</strong> हे पीक सर्वात सुरक्षित आहे. एल निनो जोखीम (${topCrop.totalRiskPct}%) वजा करून प्रति एकर <strong>₹${fmt(topCrop.riskAdjustedNetProfitAcre)}</strong> (एकूण ${plot.plotAcres} एकरासाठी <strong>₹${fmt(topCrop.totalPlotNetProfit)}</strong>) निव्वळ नफा अपेक्षित आहे.</li>
          <li><strong>🧪 बियाणे व फवारणी नियोजन:</strong> ${plot.plotAcres} एकर क्षेत्रासाठी एकूण <strong>${seedPlan.totalSeedKg} किलो</strong> बियाणे लागेल (पेर्णीपूर्वी ${seedPlan.trichodermaGrams} ग्रॅम ट्रायकोडर्माची बीजप्रक्रिया करावी). आज वाऱ्याचा वेग ${weather.windSpeedKmh} km/h असल्याने ${weather.sprayWindowSafe ? '<strong>संध्याकाळी फवारणी करणे पूर्णपणे सुरक्षित आहे</strong>' : '<strong>वेगवान वाऱ्यामुळे आज फवारणी टाळावी</strong>'}.</li>
          <li><strong>💰 बाजारपेठ व साठवणूक नफा गणित:</strong> ${mandiArb.lotSizeQtl} क्विंटल माल विक्रीसाठी <strong>${bestMandi.name_mr}</strong> येथे नेल्यास वाहतूक व हमाली वजा करून सर्वाधिक <strong>₹${fmt(bestMandi.netTakeHome)}</strong> हातात पडतील (स्थानिक बाजारापेक्षा <strong>+₹${fmt(mandiArb.extraArbitrageGain)}</strong> जास्त नफा). किंवा <strong>${bestStorage.name_mr}</strong> मध्ये ३ महिने साठवल्यास <strong>₹${fmt(bestStorage.immediatePledgeLoanCash)}</strong> तात्काळ ७५% शेतमाल तारण कर्ज मिळेल व दरवाढीतून <strong>+₹${fmt(bestStorage.netExtraGainAfterRentAndInterest)}</strong> अतिरिक्त नफा होईल.</li>
        </ul>
      `;
    }

    if (lang === 'hi') {
      return `
        <ul class="list-disc pl-5 space-y-1.5">
          <li><strong>🌱 सर्वोत्तम फसल एवं मौसम जोखिम (${location.taluka}, ${location.district}):</strong> आपके खेत के <strong>pH ${soilChem.ph}</strong> और <strong>${weather.moisturePctDisplay}%</strong> जड़ नमी के अनुसार <strong>${topCrop.name_hi} (${seedPlan.varietyLocal})</strong> सबसे सुरक्षित विकल्प है। एल निनो जोखिम (${topCrop.totalRiskPct}%) घटाकर प्रति एकड़ <strong>₹${fmt(topCrop.riskAdjustedNetProfitAcre)}</strong> (कुल ${plot.plotAcres} एकड़ में <strong>₹${fmt(topCrop.totalPlotNetProfit)}</strong>) शुद्ध लाभ अनुमानित है।</li>
          <li><strong>🧪 बीज मात्रा एवं छिड़काव समय:</strong> ${plot.plotAcres} एकड़ के लिए <strong>${seedPlan.totalSeedKg} किलो</strong> प्रमाणित बीज लगेगा (${seedPlan.trichodermaGrams} ग्राम ट्राइकोडर्मा से बीजोपचार करें)। हवा की गति ${weather.windSpeedKmh} km/h होने से ${weather.sprayWindowSafe ? '<strong>आज छिड़काव करना सुरक्षित है</strong>' : '<strong>अभी छिड़काव टालें</strong>'}।</li>
          <li><strong>💰 मंडी बनाम गोदाम मुनाफा:</strong> ${mandiArb.lotSizeQtl} क्विंटल उपज <strong>${bestMandi.name_hi}</strong> में बेचने पर भाड़ा व हमाली घटाकर सर्वाधिक <strong>₹${fmt(bestMandi.netTakeHome)}</strong> मिलेंगे (स्थानीय मंडी से <strong>+₹${fmt(mandiArb.extraArbitrageGain)}</strong> अधिक)। या गोदाम में 3 माह रखने पर <strong>₹${fmt(bestStorage.immediatePledgeLoanCash)}</strong> का 75% तत्काल तारण ऋण और <strong>+₹${fmt(bestStorage.netExtraGainAfterRentAndInterest)}</strong> अतिरिक्त लाभ मिलेगा।</li>
        </ul>
      `;
    }

    return `
      <ul class="list-disc pl-5 space-y-1.5">
        <li><strong>🌱 Optimal Crop & El Niño Risk (${location.taluka}, ${location.district}):</strong> Based on your plot's soil <strong>pH ${soilChem.ph}</strong> and <strong>${weather.moisturePctDisplay}%</strong> root-zone moisture, <strong>${topCrop.name_en} (${seedPlan.varietyLocal})</strong> scores highest (${topCrop.suitabilityScore}% match). After deducting ${topCrop.totalRiskPct}% climate & volatility risk, expected net profit is <strong>₹${fmt(topCrop.riskAdjustedNetProfitAcre)}/acre</strong> (<strong>₹${fmt(topCrop.totalPlotNetProfit)}</strong> across ${plot.plotAcres} acres).</li>
        <li><strong>🧪 Seed Rate & Spray Safety:</strong> You require <strong>${seedPlan.totalSeedKg} kg</strong> seed treated with ${seedPlan.trichodermaGrams}g Trichoderma + ${seedPlan.rhizobiumGrams}g Rhizobium. Wind speed is ${weather.windSpeedKmh} km/h — ${weather.sprayWindowSafe ? '<strong>safe window active for foliar spraying</strong>' : '<strong>avoid spraying due to drift/rain risk</strong>'}.</li>
        <li><strong>💰 Mandi vs. Storage Arbitrage:</strong> Selling ${mandiArb.lotSizeQtl} quintals at <strong>${bestMandi.name_en}</strong> yields a net payout of <strong>₹${fmt(bestMandi.netTakeHome)}</strong> after freight and hamali (<strong>+₹${fmt(mandiArb.extraArbitrageGain)}</strong> over the lowest yard). Storing 90 days unlocks an immediate 75% pledge loan of <strong>₹${fmt(bestStorage.immediatePledgeLoanCash)}</strong> and nets <strong>+₹${fmt(bestStorage.netExtraGainAfterRentAndInterest)}</strong> extra gain.</li>
      </ul>
    `;
  }
}