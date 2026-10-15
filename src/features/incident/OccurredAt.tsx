import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '../../components/ui'
import { WheelPicker } from '../../components/WheelPicker'
import { addDays, tokyoParts } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { formatWhen } from './data'

/** report_incident accepts the last 14 days. */
const DAYS_BACK = 13

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (date: string, hour: number, minute: number) => new Date(`${date}T${pad(hour)}:${pad(minute)}:00+09:00`).toISOString()

/**
 * 起きた日時: 「今」 locks the time of the tap; otherwise three wheels (day of the last two weeks, hour, minute,
 * Tokyo time). The chosen value is shown in the user's language above the wheels.
 */
export function OccurredAt({ value, now, onChange, label }: { value: string; now: boolean; onChange: (iso: string, now: boolean) => void; label?: string }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const p = tokyoParts(new Date(value))
  const today = tokyoParts(new Date()).date
  const days = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' })
    return Array.from({ length: DAYS_BACK + 1 }, (_, i) => addDays(today, -DAYS_BACK + i)).map((d) => ({
      value: d,
      label: d === today ? t('incident.today') : fmt.format(new Date(`${d}T00:00:00Z`)),
    }))
  }, [locale, today, t])
  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ value: h, label: pad(h) })), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, m) => ({ value: m, label: pad(m) })), [])
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{label ?? t('incident.when')}</span>
      <Checkbox checked={now} onChange={(on) => onChange(new Date().toISOString(), on)}>
        🕒 {t('incident.now')}
      </Checkbox>
      <p className={now ? 'rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 font-bold text-slate-700' : 'px-1 font-bold text-brand'}>
        {now && '🔒 '}
        {formatWhen(value, locale)}
      </p>
      {!now && (
        <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-2">
          <WheelPicker options={days} value={p.date} onChange={(d) => onChange(isoOf(d, p.hour, p.minute), false)} />
          <WheelPicker options={hours} value={p.hour} onChange={(h) => onChange(isoOf(p.date, h, p.minute), false)} />
          <WheelPicker options={minutes} value={p.minute} onChange={(m) => onChange(isoOf(p.date, p.hour, m), false)} />
        </div>
      )}
    </div>
  )
}
