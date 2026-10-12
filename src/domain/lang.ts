// Decide whether free text must be translated to Japanese before it is saved.

// Sinhala, Devanagari (Nepali), Myanmar: never part of Japanese text
const FOREIGN_SCRIPT = /[\p{Script=Sinhala}\p{Script=Devanagari}\p{Script=Myanmar}]/u
// Latin letters with diacritics (Vietnamese etc.), without × and ÷
const ACCENTED_LATIN = /[À-ÖØ-öø-ɏḀ-ỿ]/u
// two or more Latin words in a row ("says hello", "Garbage bins") — a sentence, not a loanword
const LATIN_PHRASE = /\p{Script=Latin}+[\s,.'’!?-]+\p{Script=Latin}+/u
const LATIN = /\p{Script=Latin}/gu
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu
// words quoted in Japanese brackets, e.g. 『Thank you』も言いましょう
const QUOTED = /[「『][^」』]*[」』]/gu

/**
 * Translate anything that is not fully Japanese, including mixed text such as
 * "Everyone says いらっシャイ within 3seconds". Japanese with a single Latin word
 * ("ネギ ok", "QRコード"), a phrase quoted in 「」『』, or kanji / numbers only
 * ("大丈夫", "120杯") is left as is.
 */
export function needsTranslation(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (FOREIGN_SCRIPT.test(t) || ACCENTED_LATIN.test(t)) return true
  const japanese = t.match(JAPANESE)?.length ?? 0
  const rest = japanese > 0 ? t.replace(QUOTED, '「」') : t
  if (LATIN_PHRASE.test(rest)) return true
  const latin = rest.match(LATIN)?.length ?? 0
  return latin > japanese
}
