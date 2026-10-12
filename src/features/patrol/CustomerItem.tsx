import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, TextArea } from '../../components/ui'
import { cx } from '../../lib/cx'

export interface CustomerAnswer {
  customerNone?: boolean
  customerSatisfied?: boolean
  customerReason?: string
}

/** The saved answer as text for history / manager screens; null for records sent before ⑥ existed. */
export function CustomerResult({ r }: { r: { customer_none?: boolean; customer_satisfied?: boolean | null; customer_reason?: string | null } }) {
  const { t } = useTranslation('patrol')
  if (r.customer_none) return <span>{t('customer.none')}</span>
  if (r.customer_satisfied === true) return <span>○ {t('customer.yes')}</span>
  if (r.customer_satisfied === false)
    return (
      <span className="font-bold text-red-700">
        × {t('customer.no')}
        {r.customer_reason && <span className="block font-normal text-slate-900">{r.customer_reason}</span>}
      </span>
    )
  return null
}

/** ⑥ お客様の満足度: はい / いいえ (with a reason), or お客様がいない. Not part of the score. */
export function CustomerItem({ value, onChange, missing }: { value: CustomerAnswer; onChange: (patch: CustomerAnswer) => void; missing: boolean }) {
  const { t } = useTranslation('patrol')
  const headingId = useId()
  const none = Boolean(value.customerNone)
  const answered = none || value.customerSatisfied !== undefined
  const choice = (yes: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={value.customerSatisfied === yes}
      disabled={none}
      onClick={() => onChange({ customerSatisfied: yes })}
      className={cx(
        'min-h-12 rounded-xl border-[1.5px] px-3 text-lg font-bold disabled:opacity-40',
        value.customerSatisfied === yes ? (yes ? 'border-brand bg-brand text-white' : 'border-red-700 bg-red-700 text-white') : 'border-line bg-white',
      )}
    >
      {yes ? `○ ${t('customer.yes')}` : `× ${t('customer.no')}`}
    </button>
  )

  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl border bg-white p-4', missing && !answered ? 'border-red-600 ring-2 ring-red-600' : 'border-line')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">
          {t('customer.name')}
        </h2>
        <span className="shrink-0 text-xs text-slate-600">{t('customer.notScored')}</span>
      </div>
      <p className="font-bold">{t('customer.question')}</p>
      <p className="text-xs text-slate-600">{t('customer.example')}</p>
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-2 gap-2">
        {choice(true)}
        {choice(false)}
      </div>
      {value.customerSatisfied === false && !none && (
        <TextArea
          label={`${t('customer.reason')} *`}
          placeholder={t('customer.reasonPlaceholder')}
          value={value.customerReason ?? ''}
          onChange={(e) => onChange({ customerReason: e.target.value })}
          error={missing && !value.customerReason?.trim() ? t('common:error.required') : null}
        />
      )}
      <div className="rounded-xl bg-slate-50 px-2">
        <Checkbox checked={none} onChange={(on) => onChange({ customerNone: on, customerSatisfied: undefined })}>
          {t('customer.none')}
        </Checkbox>
      </div>
      {missing && !answered && <p className="text-sm font-bold text-red-700">{t('customer.needAnswer')}</p>}
    </div>
  )
}
