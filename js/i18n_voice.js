// ============================================================================
// js/i18n_voice.js — Auto-Local Language Engine + Top-Right Switcher + Voice
// ============================================================================

export class I18nVoiceEngine {
  constructor() {
    this.dict = {};
    this.currentLang = 'mr'; // Default local language for Maharashtra farmers
    this.userManuallyLocked = false;
    this.onLanguageChangeCallback = null;
  }

  async init(onLanguageChangeCallback) {
    this.onLanguageChangeCallback = onLanguageChangeCallback;

    // Load dictionary JSON
    const res = await fetch('./data/i18n_dict.json');
    this.dict = await res.json();

    // Stage 1: Instant Boot Language Detection
    const savedLang = localStorage.getItem('kisan_lang');
    if (savedLang && this.dict[savedLang]) {
      this.currentLang = savedLang;
      this.userManuallyLocked = true;
    } else {
      const browserLocale = (navigator.language || '').toLowerCase();
      if (browserLocale.startsWith('hi')) {
        this.currentLang = 'hi';
      } else {
        // Default to Marathi ('mr') for local regional accessibility
        this.currentLang = 'mr';
      }
    }

    this.bindTopRightSwitcher();
    this.bindVoiceButtons();
    this.applyTranslations();
  }

  // Stage 2: Called after GPS reverse-geocoding resolves the exact Indian State
  autoSwitchByDetectedState(stateName = '') {
    if (this.userManuallyLocked) return;
    const s = stateName.toLowerCase();
    if (s.includes('maharashtra') || s.includes('महाराष्ट्र')) {
      this.setLanguage('mr', false);
    } else if (
      s.includes('madhya pradesh') ||
      s.includes('uttar pradesh') ||
      s.includes('rajasthan') ||
      s.includes('bihar') ||
      s.includes('haryana')
    ) {
      this.setLanguage('hi', false);
    }
  }

  bindTopRightSwitcher() {
    const buttons = document.querySelectorAll('[data-lang-switch]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = btn.getAttribute('data-lang-switch');
        this.setLanguage(chosen, true);
      });
    });
  }

  setLanguage(langCode, isManualClick = false) {
    if (!this.dict[langCode]) return;
    this.currentLang = langCode;
    document.documentElement.lang = langCode;

    if (isManualClick) {
      this.userManuallyLocked = true;
      localStorage.setItem('kisan_lang', langCode);
    }

    // Highlight active button in Top-Right Switcher
    document.querySelectorAll('[data-lang-switch]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lang-switch') === langCode);
    });

    this.applyTranslations();

    if (typeof this.onLanguageChangeCallback === 'function') {
      this.onLanguageChangeCallback(this.currentLang);
    }
  }

  applyTranslations() {
    const strings = this.dict[this.currentLang] || this.dict.mr;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (strings[key]) {
        el.textContent = strings[key];
      }
    });
  }

  t(key) {
    return (this.dict[this.currentLang] && this.dict[this.currentLang][key]) || key;
  }

  // Web Speech API readout in Marathi (mr-IN), Hindi (hi-IN), or English (en-IN)
  speakText(rawText) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const cleanText = rawText.replace(/[🟢🟠🔴🤖🌦️🌾🌱🚛🏢🤝🏛️🚁📍✅🗺️⚠️]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const langMap = { mr: 'mr-IN', hi: 'hi-IN', en: 'en-IN' };
    utterance.lang = langMap[this.currentLang] || 'mr-IN';
    utterance.rate = 0.95;

    window.speechSynthesis.speak(utterance);
  }

  bindVoiceButtons() {
    // Modal voice readout
    const modalBtn = document.getElementById('btn-speak-modal');
    if (modalBtn) {
      modalBtn.addEventListener('click', () => {
        const title = this.t('modal_title');
        const desc = this.t('modal_desc');
        this.speakText(`${title}. ${desc}`);
      });
    }

    // Card-level voice readout buttons
    document.querySelectorAll('.btn-voice-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-voice-target');
        const container = document.getElementById(targetId);
        if (container) {
          this.speakText(container.innerText);
        }
      });
    });
  }
}