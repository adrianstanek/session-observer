'use strict';
// Session Observer dashboard — languages: the text tables (one file per language, i18n-<code>.js) register into TEXT,
// and core.js picks one as TX. Text with values in it is a function, so each language writes the whole phrase itself.
// A new language: one more i18n-<code>.js, one more line in LANGS, and the file listed in dashboard.html.
const TEXT = {};
// the language menu, in this order: each language by its own name
const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', pl: 'Polski', pt: 'Português',
  // scripts not everyone can read also carry their English name
  ja: '日本語 (Japanese)', ko: '한국어 (Korean)', zh: '简体中文 (Chinese, Simplified)',
};

// a plural noun, chosen by the language's own plural rules: W('en', 'tool', 'tools');
// Polish has a third form for 0 and 5+ (W('pl', 'plik', 'pliki', 'plików')); Japanese, Chinese and Korean have one
const W = (lang, one, few = one, many = few) => {
  const pr = new Intl.PluralRules(lang);
  return n => { const c = pr.select(n); return c === 'one' ? one : c === 'many' ? many : few; };
};

// the saved choice, else the browser's first language there is a table for, else English
function pickLang() {
  let saved = null;
  try { saved = localStorage.getItem('so.lang'); } catch { /* no storage */ }
  if (saved && TEXT[saved]) return saved;
  const nav = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language];
  for (const l of nav) {
    const k = String(l || '').slice(0, 2).toLowerCase();
    if (k === 'zh' && /-(tw|hk|mo|hant)\b/i.test(l)) continue; // the Chinese table is Simplified: Traditional readers get the next choice
    if (TEXT[k]) return k;
  }
  return 'en';
}
// the table for a language; anything it lacks comes from English (one level deep: st, cat, w, …)
function textFor(lang) {
  const en = TEXT.en, x = TEXT[lang] || en, out = { ...en, ...x };
  for (const [k, v] of Object.entries(en)) if (v && typeof v === 'object') out[k] = { ...v, ...(x[k] || {}) };
  return out;
}
// the page's own text: data-t (text), data-t-title, data-t-ph (placeholder), data-t-aria (aria-label)
function applyText(root = document) {
  const put = (attr, set) => { for (const el of root.querySelectorAll(`[${attr}]`)) { const v = TX[el.getAttribute(attr)]; if (typeof v === 'string') set(el, v); } };
  put('data-t', (el, v) => { el.textContent = v; });
  put('data-t-title', (el, v) => { el.title = v; });
  put('data-t-ph', (el, v) => { el.placeholder = v; });
  put('data-t-aria', (el, v) => { el.setAttribute('aria-label', v); });
  document.documentElement.lang = LANG;
}
