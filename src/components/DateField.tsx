import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, tokyoParts } from '../domain/time'
import { currentLocale } from '../i18n'
import { WheelPicker } from './WheelPicker'

/** 2026年10月15日(木) / Thứ 5, 15 tháng 10, 2026 — a YYYY-MM-DD date in the user's language. */
function formatDateLong(date: string, locale = currentLocale()) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}

/**
 * Date picker in place of the browser's date box (which overflows on iPhone and follows the phone's language):
 * the chosen date in the user's language, and a wheel of days from `back` days ago to `ahead` days ahead
 * (Tokyo). 昨日 / 今日 / 明日 are named; a value outside the range is kept as a row.
 */
export function DateField({
  label,
  value,
  onChange,
  back = 7,
  ahead = 1,
}: {
  label: string
  value: string
  onChange: (date: string) => void
  back?: number
  ahead?: number
}) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const today = tokyoParts(new Date()).date
  const options = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' })
    const named: Record<string, string> = { [addDays(today, -1)]: t('common:date.yesterday'), [today]: t('common:date.today'), [addDays(today, 1)]: t('common:date.tomorrow') }
    const days = Array.from({ length: back + ahead + 1 }, (_, i) => addDays(today, i - back))
    if (value && !days.includes(value)) days.push(value)
    return days.sort().map((d) => {
      const short = fmt.format(new Date(`${d}T00:00:00Z`))
      return { value: d, label: named[d] ? `${short}・${named[d]}` : short }
    })
  }, [locale, today, back, ahead, value, t])
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{label}</span>
      <p className="px-1 font-bold text-brand">{value ? formatDateLong(value, locale) : '—'}</p>
      <WheelPicker options={options} value={value || null} onChange={onChange} />
    </div>
  )
}
