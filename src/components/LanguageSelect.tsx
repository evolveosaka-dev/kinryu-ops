import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { LOCALES, type Locale } from '../domain/types'
import { currentLocale } from '../i18n'

export function LanguageSelect({ onChange, compact = false }: { onChange?: (l: Locale) => void; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className={compact ? 'sr-only' : 'font-bold text-slate-700'}>{t('lang.label')}</span>
      {compact && <Icon name="globe" size={18} className="text-muted" />}
      <select
        className="min-h-10 rounded-lg border border-line bg-white px-2 text-sm"
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
