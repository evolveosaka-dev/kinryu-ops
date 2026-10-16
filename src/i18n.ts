import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { LOCALES, type Locale } from './domain/types'

import jaCommon from './locales/ja/common.json'
import jaChorei from './locales/ja/chorei.json'
import jaPatrol from './locales/ja/patrol.json'
import jaManager from './locales/ja/manager.json'
import enCommon from './locales/en/common.json'
import enChorei from './locales/en/chorei.json'
import enPatrol from './locales/en/patrol.json'
import enManager from './locales/en/manager.json'
import viCommon from './locales/vi/common.json'
import viChorei from './locales/vi/chorei.json'
import viPatrol from './locales/vi/patrol.json'
import siCommon from './locales/si/common.json'
import siChorei from './locales/si/chorei.json'
import siPatrol from './locales/si/patrol.json'
import jaGenko from './locales/ja/genko.json'
import enGenko from './locales/en/genko.json'
import viGenko from './locales/vi/genko.json'
import siGenko from './locales/si/genko.json'
import neGenko from './locales/ne/genko.json'
import jaShift from './locales/ja/shift.json'
import enShift from './locales/en/shift.json'
import viShift from './locales/vi/shift.json'
import siShift from './locales/si/shift.json'
import neShift from './locales/ne/shift.json'
import neCommon from './locales/ne/common.json'
import jaLearn from './locales/ja/learn.json'
import enLearn from './locales/en/learn.json'
import viLearn from './locales/vi/learn.json'
import siLearn from './locales/si/learn.json'
import neLearn from './locales/ne/learn.json'
import jaStock from './locales/ja/stock.json'
import enStock from './locales/en/stock.json'
import viStock from './locales/vi/stock.json'
import siStock from './locales/si/stock.json'
import neStock from './locales/ne/stock.json'
import jaSales from './locales/ja/sales.json'
import enSales from './locales/en/sales.json'
import viSales from './locales/vi/sales.json'
import siSales from './locales/si/sales.json'
import neSales from './locales/ne/sales.json'
import neChorei from './locales/ne/chorei.json'
import nePatrol from './locales/ne/patrol.json'
import myCommon from './locales/my/common.json'
import myChorei from './locales/my/chorei.json'
import myPatrol from './locales/my/patrol.json'
import myGenko from './locales/my/genko.json'
import myShift from './locales/my/shift.json'
import myLearn from './locales/my/learn.json'
import myStock from './locales/my/stock.json'
import mySales from './locales/my/sales.json'

export const resources = {
  ja: { common: jaCommon, chorei: jaChorei, patrol: jaPatrol, manager: jaManager, genko: jaGenko, shift: jaShift, learn: jaLearn, stock: jaStock, sales: jaSales },
  en: { common: enCommon, chorei: enChorei, patrol: enPatrol, manager: enManager, genko: enGenko, shift: enShift, learn: enLearn, stock: enStock, sales: enSales },
  vi: { common: viCommon, chorei: viChorei, patrol: viPatrol, genko: viGenko, shift: viShift, learn: viLearn, stock: viStock, sales: viSales },
  si: { common: siCommon, chorei: siChorei, patrol: siPatrol, genko: siGenko, shift: siShift, learn: siLearn, stock: siStock, sales: siSales },
  ne: { common: neCommon, chorei: neChorei, patrol: nePatrol, genko: neGenko, shift: neShift, learn: neLearn, stock: neStock, sales: neSales },
  my: { common: myCommon, chorei: myChorei, patrol: myPatrol, genko: myGenko, shift: myShift, learn: myLearn, stock: myStock, sales: mySales },
} as const

// Load only the font a locale needs (slow mobile data).
const FONT_FAMILIES: Partial<Record<Locale, string>> = {
  vi: 'Noto+Sans:wght@400;700',
  si: 'Noto+Sans+Sinhala:wght@400;700',
  ne: 'Noto+Sans+Devanagari:wght@400;700',
  my: 'Noto+Sans+Myanmar:wght@400;700',
}
const JP_FONT = 'BIZ+UDPGothic:wght@400;700'

function ensureFont(family: string) {
  const id = `font-${family}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`
  document.head.appendChild(link)
}

export function isLocale(value: string | undefined | null): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '')
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: [...LOCALES],
    nonExplicitSupportedLngs: true,
    fallbackLng: 'ja',
    defaultNS: 'common',
    ns: ['common', 'chorei', 'patrol', 'manager', 'genko', 'shift', 'learn', 'stock', 'sales'],
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'kinryu.locale' },
  })

function applyLanguage(lng: string) {
  const locale = lng.slice(0, 2)
  document.documentElement.lang = locale
  ensureFont(JP_FONT)
  const extra = isLocale(locale) ? FONT_FAMILIES[locale] : undefined
  if (extra) ensureFont(extra)
}
i18n.on('languageChanged', applyLanguage)
if (typeof document !== 'undefined') applyLanguage(i18n.language ?? 'ja')

export function currentLocale(): Locale {
  const l = (i18n.resolvedLanguage ?? i18n.language ?? 'ja').slice(0, 2)
  return isLocale(l) ? l : 'ja'
}

export default i18n
