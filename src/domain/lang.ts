// Decide whether free text must be translated to Japanese before it is saved.

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
// Latin (incl. Vietnamese), Sinhala, Devanagari (Nepali), Myanmar
const FOREIGN_LETTERS = /[\p{Script=Latin}\p{Script=Sinhala}\p{Script=Devanagari}\p{Script=Myanmar}]/u

/**
 * Japanese text always contains kana; text with foreign letters and no kana is translated.
 * Kanji-only or number-only text (e.g. "大丈夫", "120杯") is treated as Japanese.
 */
export function needsTranslation(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (KANA.test(t)) return false
  return FOREIGN_LETTERS.test(t)
}
