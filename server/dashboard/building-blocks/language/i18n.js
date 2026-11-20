'use strict';
// Session Observer dashboard — languages: the text tables (one file per language, translations/<code>.js) register
// into TRANSLATIONS, and selected-language.js picks one as TEXT. Text with values in it is a function, so each language
// writes the whole phrase itself. A new language: one more translations/<code>.js, one more line in LANGUAGE_NAMES,
// and the file listed in dashboard.html.
const TRANSLATIONS = {};
// the language menu, in this order: each language by its own name
const LANGUAGE_NAMES = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', pl: 'Polski', pt: 'Português',
  // scripts not everyone can read also carry their English name
  ja: '日本語 (Japanese)', ko: '한국어 (Korean)', zh: '简体中文 (Chinese, Simplified)',
};
const LANGUAGE_STORAGE_KEY = 'so.lang';

// A plural noun, chosen by the language's own plural rules: pluralNoun('en', 'tool', 'tools').
// Polish has a third form for 0 and 5+ (pluralNoun('pl', 'plik', 'pliki', 'plików')); Japanese, Chinese and Korean
// have one form.
function pluralNoun(language, one, few = one, many = few) {
  const rules = new Intl.PluralRules(language);
  return count => {
    const category = rules.select(count);
    if (category === 'one') return one;
    if (category === 'many') return many;
    return few;
  };
}

function savedLanguage() {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { return null; }
}

// the browser's preferred languages, best first ("en-GB", "pl"…)
const browserLanguages = () => (typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]);

// the saved choice, else the browser's first language there is a table for, else English
function pickLanguage() {
  const saved = savedLanguage();
  if (saved && TRANSLATIONS[saved]) return saved;
  for (const tag of browserLanguages()) {
    const code = String(tag || '').slice(0, 2).toLowerCase();
    // the Chinese table is Simplified: Traditional readers get their next choice
    if (code === 'zh' && /-(tw|hk|mo|hant)\b/i.test(tag)) continue;
    if (TRANSLATIONS[code]) return code;
  }
  return 'en';
}

// the table for a language; anything it lacks comes from English (one level deep: groups, categories, nouns, …)
function textTableFor(language) {
  const english = TRANSLATIONS.en, chosen = TRANSLATIONS[language] || english;
  const table = { ...english, ...chosen };
  for (const [key, value] of Object.entries(english)) {
    if (value && typeof value === 'object') table[key] = { ...value, ...(chosen[key] || {}) };
  }
  return table;
}

// the page's own text: data-t (text), data-t-title, data-t-ph (placeholder), data-t-aria (aria-label)
function applyPageText(root = document) {
  const fill = (attribute, apply) => {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      const text = TEXT[element.getAttribute(attribute)];
      if (typeof text === 'string') apply(element, text);
    }
  };
  fill('data-t', (element, text) => { element.textContent = text; });
  fill('data-t-title', (element, text) => { element.title = text; });
  fill('data-t-ph', (element, text) => { element.placeholder = text; });
  fill('data-t-aria', (element, text) => { element.setAttribute('aria-label', text); });
  document.documentElement.lang = LANGUAGE;
}
