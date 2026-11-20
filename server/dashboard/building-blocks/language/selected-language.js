'use strict';
// Session Observer dashboard — the chosen language: its text table, which every view reads, and the locale for times.
// (i18n.js and the translation tables load before this file.)
const LANGUAGE = pickLanguage();
const TEXT = textTableFor(LANGUAGE);
// times in the chosen language, in the browser's regional variant of it when it has one (en-GB: 24 h, en-US: AM/PM)
const TIME_LOCALE = browserLanguages().find(tag => String(tag).toLowerCase().startsWith(LANGUAGE)) || LANGUAGE;
