import { useTranslation } from 'react-i18next'
import { LOCALES, type Locale } from '../domain/types'
import { currentLocale } from '../i18n'

export function LanguageSelect({ onChange, compact = false }: { onChange?: (l: Locale) => void; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className={compact ? 'sr-only' : 'font-bold text-slate-700'}>🌐 {t('lang.label')}</span>
      {compact && <span aria-hidden>🌐</span>}
      <select
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm"
        value={currentLocale()}
        onChange={(e) => {
          const l = e.target.value as Locale
          void i18n.changeLanguage(l)
          onChange?.(l)
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`lang.${l}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
