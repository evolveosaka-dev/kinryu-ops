import { useTranslation } from 'react-i18next'
import { formatShortDate, formatTokyoTime } from '../../domain/time'
import type { HandoverSummary } from '../../lib/types'

export function HandoverCard({ handover }: { handover: HandoverSummary | null }) {
  const { t } = useTranslation('chorei')
  return (
    <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="mb-2 font-bold text-amber-900">📋 {t('previous.title')}</h2>
      {!handover ? (
        <p className="text-sm text-slate-600">{t('previous.none')}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">
            {formatShortDate(handover.business_date)} {t(`common:shift.${handover.shift}`)}
          </dt>
          <dd>
            {handover.leader}（{formatTokyoTime(new Date(handover.submitted_at))}）
          </dd>
          <dt className="font-bold">{t('previous.stock')}</dt>
          <dd lang="ja">{handover.stock_none ? t('stock.none') : handover.stock_text}</dd>
          <dt className="font-bold">{t('previous.target')}</dt>
          <dd>{handover.target_bowls ?? '—'}</dd>
          <dt className="font-bold">{t('previous.caution')}</dt>
          <dd lang="ja">{handover.caution_text || '—'}</dd>
          {handover.notes.length > 0 && (
            <>
              <dt className="font-bold">{t('previous.notes')}</dt>
              <dd>
                <ul>
                  {handover.notes.map((n, i) => (
                    <li key={i}>
                      {n.body}（{n.author}）
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
