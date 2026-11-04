// ============================================================================
// js/ai_krishi_mitra.js — Native Chrome Built-In AI + Live Diagnostics Inspector
// ============================================================================

export class KrishiMitraAI {
  constructor() {
    this.session = null;
    this.translators = new Map();
  }

  async streamTextIntoElement(element, htmlContent) {
    if (!element) return;
    element.innerHTML = htmlContent;
  }

  getLanguageModelNamespace() {
    if ('LanguageModel' in self) return self.LanguageModel;
    if (window.ai && window.ai.languageModel) return window.ai.languageModel;
    return null;
  }

  // Diagnostic Inspector for Chrome Built-In AI
  async runDiagnostics() {
    const lines = [];
    const LM = this.getLanguageModelNamespace();

    lines.push(`• window.ai support: ${!!window.ai ? 'YES' : 'NO'}`);
    lines.push(`• self.LanguageModel support: ${!!('LanguageModel' in self) ? 'YES' : 'NO'}`);
    lines.push(`• self.Translator support: ${!!('Translator' in self) ? 'YES' : 'NO'}`);

    if (LM) {
      try {
        let st = 'unknown';
        if (typeof LM.availability === 'function') {
          st = await LM.availability({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }]
          }).catch(() => LM.availability());
        } else if (typeof LM.capabilities === 'function') {
          const c = await LM.capabilities();
          st = c?.available || 'unknown';
        }
        lines.push(`• LanguageModel Availability: [${st}]`);
      } catch (e) {
        lines.push(`• LanguageModel availability check error: ${e.message}`);
      }
    } else {
      lines.push(`• LanguageModel namespace: NOT FOUND (Check chrome://flags)`);
    }

    if ('Translator' in self && typeof self.Translator.availability === 'function') {
      try {
        const trSt = await self.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'mr' });
        lines.push(`• Translator (en ➔ mr) Availability: [${trSt}]`);
      } catch (e) {
        lines.push(`• Translator availability check error: ${e.message}`);
      }
    } else {
      lines.push(`• Translator namespace: NOT FOUND`);
    }

    return lines.join('\n');
  }

  async generateExecutiveAdvisory(context, lang = 'mr', customQuestion = null, onChunkCallback = null) {
    const providerPref = localStorage.getItem('kisan_ai_provider') || 'auto';
    const geminiKey = localStorage.getItem('kisan_gemini_key') || '';
    const { systemPromptEn, userPromptEn } = this.buildEnglishPromptsForNano(context, customQuestion);

    // 1. Try Google Gemini API Key if saved
    if (geminiKey && (providerPref === 'chrome' || providerPref === 'auto')) {
      try {
        const geminiText = await this.callGeminiAPI(geminiKey, systemPromptEn, userPromptEn);
        if (geminiText) {
          return {
            tierBadge: 'Gemini 2.5 Flash API',
            html: this.formatMarkdownToHtml(geminiText)
          };
        }
      } catch (e) {
        console.warn('Gemini API error:', e.message);
      }
    }

    // 2. Try Chrome Built-In AI (LanguageModel + Translator)
    const LM = this.getLanguageModelNamespace();
    if (LM && providerPref !== 'cloud') {
      try {
        const englishOutput = await this.runChromeBuiltInLanguageModel(
          LM,
          systemPromptEn,
          userPromptEn,
          lang === 'en' ? onChunkCallback : null
        );

        if (englishOutput && englishOutput.trim().length > 15) {
          const finalOutput =
            lang === 'en'
              ? englishOutput
              : await this.translateEnglishToIndic(englishOutput, lang);

          return {
            tierBadge: 'Chrome Built-In AI (Nano)',
            html: this.formatMarkdownToHtml(finalOutput)
          };
        }
      } catch (chromeErr) {
        console.warn('Chrome AI exception:', chromeErr.name, chromeErr.message);
      }
    }

    // 3. Cloud Generative LLM Fallback
    try {
      const cloudText = await this.callZeroKeyCloudLLM(systemPromptEn, userPromptEn, lang);
      if (cloudText) {
        return {
          tierBadge: 'Cloud Generative LLM',
          html: this.formatMarkdownToHtml(cloudText)
        };
      }
    } catch (cloudErr) {
      console.warn('Cloud fallback:', cloudErr.message);
    }

    // 4. Offline Quantitative Telemetry Synthesis
    return {
      tierBadge: 'Quantitative DSS Mode',
      html: this.buildDynamicSynthesis(context, lang, customQuestion)
    };
  }

  async runChromeBuiltInLanguageModel(LM, systemPromptEn, userPromptEn, onLiveChunk) {
    const createOptions = {
      initialPrompts: [{ role: 'system', content: systemPromptEn }],
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : Math.round(e.loaded * 100);
          const badge = document.getElementById('ai-tier-badge');
          if (badge) badge.textContent = `Downloading Gemini Nano (${pct}%)...`;
        });
      }
    };

    let session;
    try {
      session = await LM.create(createOptions);
    } catch {
      session = await LM.create({ systemPrompt: systemPromptEn });
    }

    if (typeof session.promptStreaming === 'function') {
      const stream = session.promptStreaming(userPromptEn);
      let accumulated = '';
      let previousChunk = '';

      for await (const chunk of stream) {
        const newPiece = chunk.startsWith(previousChunk)
          ? chunk.slice(previousChunk.length)
          : chunk;
        accumulated += newPiece;
        previousChunk = chunk;

        if (typeof onLiveChunk === 'function') {
          onLiveChunk(this.formatMarkdownToHtml(accumulated));
        }
      }
      session.destroy?.();
      return accumulated;
    }

    const fullResult = await session.prompt(userPromptEn);
    session.destroy?.();
    return fullResult;
  }

  async translateEnglishToIndic(englishText, targetLang = 'mr') {
    if ('Translator' in self && typeof self.Translator.create === 'function') {
      try {
        const pairOpts = { sourceLanguage: 'en', targetLanguage: targetLang };
        const cacheKey = `en-${targetLang}`;
        if (!this.translators.has(cacheKey)) {
          const translator = await self.Translator.create(pairOpts);
          this.translators.set(cacheKey, translator);
        }
        const translator = this.translators.get(cacheKey);
        const lines = englishText.split('\n').filter((l) => l.trim());
        const translatedLines = [];
        for (const line of lines) {
          translatedLines.push(await translator.translate(line));
        }
        return translatedLines.join('\n');
      } catch (tErr) {
        console.warn('Chrome Translator fallback to GTX:', tErr.message);
      }
    }

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(
        englishText
      )}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const translated = (data[0] || []).map((seg) => seg[0]).join('');
        if (translated) return translated;
      }
    } catch {
      // Return English if offline
    }

    return englishText;
  }

  buildEnglishPromptsForNano(ctx, customQuestion) {
    const allCropsSummary = (ctx.allCrops || [])
      .slice(0, 3)
      .map(
        (c) =>
          `${c.name_en} (Suitability ${c.suitabilityScore}%, Yield ${c.dynamicYieldQtlAcre} Qtl/acre, Net Profit Rs.${c.riskAdjustedNetProfitAcre}/acre, Risk ${c.totalRiskPct}%)`
      )
      .join('; ');

    const telemetry = {
      village: ctx.location.village,
      taluka: ctx.location.taluka,
      district: ctx.location.district,
      acres: ctx.plot.plotAcres,
      irrigation: ctx.plot.hasIrrigation ? 'Irrigated' : 'Rainfed',
      tempC: ctx.weather.tempC,
      rainProbPct: ctx.weather.rainProbPct,
      rootMoisturePct: ctx.weather.moisturePctDisplay,
      soilPh: ctx.soilChem.ph,
      topCrops: allCropsSummary,
      selectedCrop: `${ctx.topCrop.name_en} (${ctx.seedPlan.varietyLocal})`,
      seedNeededKg: ctx.seedPlan.totalSeedKg,
      npkSchedule: ctx.seedPlan.npkSchedule,
      bestMandi: `${ctx.bestMandi.name_en} (${ctx.bestMandi.roadKm} km, Net Payout Rs.${ctx.bestMandi.netTakeHome})`,
      warehouseLoan: `Rs.${ctx.bestStorage.immediatePledgeLoanCash} (75% Pledge Loan at ${ctx.bestStorage.name_en})`,
      topScheme: `${ctx.topScheme?.title_en} (${ctx.topScheme?.subsidyPct}% grant = Rs.${ctx.topScheme?.estimatedSubsidyINR})`
    };

    const systemPromptEn =
      'You are Krishi-Mitra, a senior agricultural scientist in Maharashtra, India. ' +
      'Write 3 short, practical bullet points in plain English using the exact numbers from the farm telemetry JSON. Do not use emojis.';

    const userPromptEn = customQuestion
      ? `Farmer Question: "${customQuestion}"\nFarm Telemetry JSON: ${JSON.stringify(telemetry)}\nAnswer the question in 3 concise bullet points citing the exact numbers above.`
      : `Farm Telemetry JSON: ${JSON.stringify(telemetry)}\nWrite a 3-bullet farm advisory covering: (1) Why ${ctx.topCrop.name_en} is the best choice for soil pH ${ctx.soilChem.ph} and ${ctx.weather.moisturePctDisplay}% root moisture, (2) Exact seed quantity (${ctx.seedPlan.totalSeedKg} kg) and NPK fertilizer schedule for ${ctx.plot.plotAcres} acres, and (3) Selling at ${ctx.bestMandi.name_en} vs taking the Rs.${ctx.bestStorage.immediatePledgeLoanCash} warehouse loan.`;

    return { systemPromptEn, userPromptEn };
  }

  async callGeminiAPI(apiKey, systemPromptEn, userPromptEn) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPromptEn }] },
        contents: [{ role: 'user', parts: [{ text: userPromptEn }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 550 }
      })
    });
    if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  async callZeroKeyCloudLLM(systemPromptEn, userPromptEn, lang) {
    const langName = lang === 'mr' ? 'Marathi' : lang === 'hi' ? 'Hindi' : 'English';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);

    try {
      const res = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'openai',
          messages: [
            { role: 'system', content: `${systemPromptEn} Respond strictly in ${langName}.` },
            { role: 'user', content: userPromptEn }
          ],
          temperature: 0.4
        })
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  formatMarkdownToHtml(rawText) {
    const clean = rawText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    const lines = clean
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return `<ul class="list-disc pl-5 space-y-1.5">${lines
      .map((line) => {
        const formatted = line
          .replace(/^[\*\-\d\.]+\s*/, '')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<li>${formatted}</li>`;
      })
      .join('')}</ul>`;
  }

  buildDynamicSynthesis(ctx, lang, customQuestion) {
    const { plot, location, weather, soilChem, topCrop, allCrops, seedPlan, bestMandi, mandiArb, bestStorage, topScheme } = ctx;
    const fmt = (n) => Number(n).toLocaleString('en-IN');
    const secondCrop = (allCrops && allCrops[1]) || topCrop;

    if (customQuestion) {
      return `
        <ul class="list-disc pl-5 space-y-1.5">
          <li><strong>प्रश्नाचे थेट विश्लेषण (${location.village}, ता. ${location.taluka}):</strong> ${plot.plotAcres} एकर (${plot.hasIrrigation ? 'बागायती' : 'कोरडवाहू'}) क्षेत्रात सध्या मुळाशी <strong>${weather.moisturePctDisplay}% ओलावा</strong> आणि मातीचा सामू <strong>pH ${soilChem.ph}</strong> आहे.</li>
          <li><strong>पीक व खत शिफारस:</strong> <strong>${topCrop.name_mr}</strong> मधून प्रति एकर <strong>${topCrop.dynamicYieldQtlAcre} क्विंटल</strong> उत्पादन व <strong>₹${fmt(topCrop.riskAdjustedNetProfitAcre)}</strong> निव्वळ नफा मिळतो. शिफारस खत डोस: <strong>${seedPlan.npkSchedule}</strong>.</li>
          <li><strong>बाजारपेठ व अनुदान:</strong> <strong>${bestMandi.name_mr}</strong> येथे विक्री केल्यास <strong>₹${fmt(bestMandi.netTakeHome)}</strong> हातात पडतील आणि <strong>${topScheme?.title_mr}</strong> मधून <strong>₹${fmt(topScheme?.estimatedSubsidyINR || 48000)}</strong> अनुदान मिळू शकते.</li>
        </ul>
      `;
    }

    if (lang === 'mr') {
      return `
        <ul class="list-disc pl-5 space-y-1.5">
          <li><strong>स्थानिक माती व पीक तुलना (${location.village}, ता. ${location.taluka}):</strong> तुमच्या शेतातील सामू (<strong>pH ${soilChem.ph}</strong>), तापमान (<strong>${weather.tempC}°C</strong>) आणि <strong>${weather.moisturePctDisplay}%</strong> मुळाशी ओलावा पाहता <strong>${topCrop.name_mr}</strong> (${topCrop.suitabilityScore}% सुयोग्य) हे पीक सर्वोत्तम असून प्रति एकर <strong>${topCrop.dynamicYieldQtlAcre} क्विंटल</strong> उत्पादन व जोखीम वजा करून <strong>₹${fmt(topCrop.riskAdjustedNetProfitAcre)}/एकर</strong> निव्वळ नफा देईल (पर्यायी <strong>${secondCrop.name_mr}</strong>: ₹${fmt(secondCrop.riskAdjustedNetProfitAcre)}/एकर).</li>
          <li><strong>बियाणे, बीजप्रक्रिया व खत मात्रा (${plot.plotAcres} एकर):</strong> एकूण <strong>${seedPlan.totalSeedKg} किलो</strong> बियाण्यास ${seedPlan.trichodermaGrams}g ट्रायकोडर्मा + ${seedPlan.rhizobiumGrams}g रायझोबियम बीजप्रक्रिया करावी आणि <strong>${seedPlan.npkSchedule}</strong> खत मात्रा द्यावी.</li>
          <li><strong>बाजारपेठ व साठवणूक निर्णय:</strong> ${mandiArb.lotSizeQtl} क्विंटल माल <strong>${bestMandi.name_mr}</strong> (${bestMandi.roadKm} km) येथे विकल्यास भाडे वजा करून सर्वाधिक <strong>₹${fmt(bestMandi.netTakeHome)}</strong> मिळतील, किंवा गोदामात ठेवल्यास तात्काळ <strong>₹${fmt(bestStorage.immediatePledgeLoanCash)}</strong> (७५% तारण कर्ज) उपलब्ध होईल.</li>
        </ul>
      `;
    }

    return `
      <ul class="list-disc pl-5 space-y-1.5">
        <li><strong>Agronomic Comparison (${location.village}, ${location.taluka}):</strong> With soil <strong>pH ${soilChem.ph}</strong>, <strong>${weather.tempC}°C</strong> temperature, and <strong>${weather.moisturePctDisplay}%</strong> root-zone moisture under <strong>${plot.hasIrrigation ? 'Irrigated' : 'Rainfed'}</strong> conditions, <strong>{topCrop.name_en}</strong> (${topCrop.suitabilityScore}% match) yields <strong>${topCrop.dynamicYieldQtlAcre} Qtl/acre</strong> and nets <strong>INR ${fmt(topCrop.riskAdjustedNetProfitAcre)}/acre</strong>.</li>
        <li><strong>Seed & Nutrient Schedule (${plot.plotAcres} Acres):</strong> Requires <strong>${seedPlan.totalSeedKg} kg</strong> certified seed treated with ${seedPlan.trichodermaGrams}g Trichoderma, paired with <strong>${seedPlan.npkSchedule}</strong>.</li>
        <li><strong>Market vs. Storage Strategy:</strong> Selling ${mandiArb.lotSizeQtl} Qtl at <strong>${bestMandi.name_en}</strong> (${bestMandi.roadKm} km) nets <strong>INR ${fmt(bestMandi.netTakeHome)}</strong> after freight, or unlocks an immediate 75% pledge loan of <strong>INR ${fmt(bestStorage.immediatePledgeLoanCash)}</strong>.</li>
      </ul>
    `;
  }
}