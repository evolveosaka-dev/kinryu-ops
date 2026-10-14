import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui'
import type { ScheduleCheck } from '../../domain/participants'
import { minutesToTime } from '../../domain/sales'
import { cx } from '../../lib/cx'

/** 参加者 differ from the shift table: show the schedule and ask the writer to confirm before saving. */
export function ScheduleCheckDialog({
  check,
  busy,
  onConfirm,
  onCancel,
}: {
  check: ScheduleCheck
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('chorei')
  const time = (s: { start_min: number; end_min: number }) => `${minutesToTime(s.start_min)}–${minutesToTime(s.end_min)}`
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="schedule-check-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <h2 id="schedule-check-title" className="text-[18px] font-bold">
          ⚠️ {t('scheduleCheck.title')}
        </h2>
        <p className="text-sm">{t('scheduleCheck.body')}</p>

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-slate-700">📅 {t('scheduleCheck.atMeeting')}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {check.atMeeting.map((s) => (
              <li key={s.roster_name} className={cx('flex items-center justify-between gap-2 px-3 py-2', !s.present && 'bg-red-50')}>
                <span className="font-bold">{s.roster_name}</span>
                <span className="text-sm tabular-nums text-slate-700">{time(s)}</span>
                <span className={cx('w-24 shrink-0 text-right text-sm font-bold', s.present ? 'text-green-700' : 'text-red-700')}>
                  {s.leader ? `✓ ${t('scheduleCheck.leader')}` : s.present ? `✓ ${t('scheduleCheck.listed')}` : `✗ ${t('scheduleCheck.notListed')}`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {check.extra.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-amber-900">➕ {t('scheduleCheck.extra')}</h3>
            <p className="rounded-xl bg-amber-50 px-3 py-2 font-bold">{check.extra.join('、')}</p>
          </section>
        )}

        {check.later.length > 0 && (
          <p className="text-xs text-muted">
            {t('scheduleCheck.later')}：{check.later.map((s) => `${s.roster_name}（${time(s)}）`).join('、')}
          </p>
        )}

        <Button onClick={onConfirm} disabled={busy}>
          {t('scheduleCheck.confirm')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('scheduleCheck.back')}
        </Button>
      </div>
    </div>
  )
}
