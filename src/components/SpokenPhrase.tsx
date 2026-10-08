import { useTranslation } from 'react-i18next'

/**
 * A phrase staff must actually say. Always shown in Japanese; romaji and the
 * translation are added underneath for non-Japanese locales.
 */
export function SpokenPhrase({ ja, romaji, tKey, ns = 'common' }: { ja: string; romaji: string; tKey: string; ns?: string }) {
  const { t, i18n } = useTranslation(ns)
  const isJa = (i18n.resolvedLanguage ?? 'ja').startsWith('ja')
  return (
    <span className="flex flex-col">
      <span lang="ja" className="font-bold">
        {ja}
      </span>
      {!isJa && (
        <>
          <span className="text-xs text-slate-500">{romaji}</span>
          <span className="text-xs text-slate-600">{t(tKey)}</span>
        </>
      )}
    </span>
  )
}
