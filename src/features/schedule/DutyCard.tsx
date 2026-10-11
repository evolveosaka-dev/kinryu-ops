import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { Card } from '../../components/ui'
import { dutyFormLink, dutyStatus, homeDuties, isUrgent, nextDuty, type Duty, type DutyStatus } from '../../domain/duty'
import { formatMin, formatRange, STORE_BY_MARK } from '../../domain/schedule'
import { tokyoParts } from '../../domain/time'
import { cx } from '../../lib/cx'
import { useStores } from '../../lib/queries'
import { useMyDuties } from './data'
import { ShiftChip, StoreLabel } from './parts'
import { useDayLabel } from './style'

const MARK_BY_CODE = Object.fromEntries(Object.entries(STORE_BY_MARK).flatMap(([mark, s]) => (s.code ? [[s.code, mark]] : [])))

const STATUS_STYLE: Record<DutyStatus, string> = {
  done: 'bg-green-100 text-green-900',
  now: 'bg-red-600 text-white',
  soon: 'bg-brand-soft text-brand-dark',
  missed: 'bg-amber-100 text-amber-900',
}

function DutyTime({ d }: { d: Duty }) {
  const { t } = useTranslation('shift')
  if (d.time_mode === 'at') return <>{formatMin(d.start_min)}</>
  if (d.time_mode === 'about') return <>{t('duty.about', { time: formatMin(d.start_min) })}</>
  if (d.time_mode === 'range') return <>{formatRange(d)}</>
  return <>{t('duty.during', { range: formatRange(d) })}</>
}

/** Later today / tomorrow, or already done: one line, no button. */
function DutyLine({ d, status, storeCode }: { d: Duty; status: DutyStatus; storeCode: string }) {
  const { t } = useTranslation('shift')
  const dayLabel = useDayLabel()
  const today = tokyoParts(new Date()).date
  return (
    <li className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-bold">
          <span aria-hidden>{d.kind === 'chorei' ? '📣 ' : '🔍 '}</span>
          {t(`duty.${d.kind}`)}
        </span>
        <span className="tabular-nums">
          {d.business_date !== today && `${dayLabel(d.business_date)} `}
          {d.time_mode === 'during' ? formatRange(d) : <DutyTime d={d} />}
        </span>
        <StoreLabel mark={MARK_BY_CODE[storeCode] ?? ''} />
      </span>
      <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold', STATUS_STYLE[status])}>
        {status === 'done' ? '✓ ' : ''}
        {t(`duty.status.${status}`)}
      </span>
    </li>
  )
}

/** Now, missed or starting within the hour: details and the button to the form. */
function DutyRow({ d, status, storeCode }: { d: Duty; status: DutyStatus; storeCode: string }) {
  const { t } = useTranslation('shift')
  const dayLabel = useDayLabel()
  const today = tokyoParts(new Date()).date
  return (
    <li className={cx('flex flex-col gap-1.5 rounded-xl border p-3', status === 'now' ? 'border-red-300 bg-red-50' : 'border-line bg-white')}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-bold">
          <span>
            <span aria-hidden>{d.kind === 'chorei' ? '📣 ' : '🔍 '}</span>
            {t(`duty.${d.kind}`)}
          </span>
          <ShiftChip shift={d.shift} />
        </p>
        <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold', STATUS_STYLE[status])}>
          {status === 'done' ? '✓ ' : ''}
          {t(`duty.status.${status}`)}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-bold tabular-nums">
          ⏰ {d.business_date !== today && `${dayLabel(d.business_date)} `}
          <DutyTime d={d} />
        </span>
        <StoreLabel mark={MARK_BY_CODE[storeCode] ?? ''} />
      </p>
      <p className="text-sm text-muted">{t(`duty.method.${d.method}`)}</p>
      {d.staff && (
        <p className="text-sm text-muted">
          👥 {t(`duty.staff.${d.kind}`)}：{d.staff}
        </p>
      )}
      {status !== 'done' && (
        <Link
          to={dutyFormLink(d, storeCode)}
          className={cx(
            'mt-1 flex min-h-11 items-center justify-center rounded-xl font-bold',
            status === 'now' ? 'bg-brand text-white hover:bg-brand-dark' : 'border-[1.5px] border-brand text-brand-dark hover:bg-brand-soft',
          )}
        >
          {t(d.kind === 'chorei' ? 'duty.doChorei' : 'duty.doPatrol')}
        </Link>
      )}
    </li>
  )
}

/** Home: the 朝礼 to lead and 巡回 to do in the next 24 h (patrol members, from the 担当表). */
export function DutyCard() {
  const { t } = useTranslation('shift')
  const me = useMe()
  const { canPatrol } = useAuth()
  const dayLabel = useDayLabel()
  const stores = useStores()
  const duties = useMyDuties(me.roster_name)
  if (!me.roster_name || !duties.data?.length || !stores.data) return null

  const now = new Date()
  const codeOf = (d: Duty) => stores.data.find((s) => s.id === d.store_id)?.code ?? ''
  // staff without the patrol flag only see their 朝礼
  const mine = canPatrol ? duties.data : duties.data.filter((d) => d.kind === 'chorei')
  const list = homeDuties(mine, now)
  const next = nextDuty(mine, now)
  if (!list.length && !next) return null
  const open = list.filter((d) => isUrgent(d, now)).length

  return (
    <Card className={open ? 'border-red-300' : 'border-blue-200'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-bold text-brand">🔔 {t('duty.title')}</p>
        {open > 0 && <span className="shrink-0 rounded-full bg-red-600 px-2.5 py-0.5 text-sm font-bold whitespace-nowrap text-white">{t('duty.open', { n: open })}</span>}
      </div>
      {list.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.map((d) =>
            isUrgent(d, now) ? (
              <DutyRow key={d.id} d={d} status={dutyStatus(d, now)} storeCode={codeOf(d)} />
            ) : (
              <DutyLine key={d.id} d={d} status={dutyStatus(d, now)} storeCode={codeOf(d)} />
            ),
          )}
        </ul>
      ) : (
        <p className="text-muted">{t('duty.noneToday')}</p>
      )}
      {next && (
        <p className="mt-3 text-sm">
          <span className="font-bold">{t('duty.next')}：</span>
          {dayLabel(next.business_date)} <DutyTime d={next} /> · {t(`duty.${next.kind}`)} · <StoreLabel mark={MARK_BY_CODE[codeOf(next)] ?? ''} />
        </p>
      )}
    </Card>
  )
}
