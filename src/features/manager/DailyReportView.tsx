import { useTranslation } from 'react-i18next'
import { Button, Card } from '../../components/ui'
import type { AiReport, DailyComment, DailyData } from '../../domain/report'
import { formatShortDate, weekdayOf } from '../../domain/time'
import { cx } from '../../lib/cx'
import { jstDateTime } from './data'

const SHIFT_JA: Record<string, string> = { early: '早番', middle: '中番', late: '遅番' }
const JUDGE_STYLE: Record<string, string> = { good: 'bg-green-100 text-green-800', improve: 'bg-amber-100 text-amber-800', coaching: 'bg-red-100 text-red-800' }

function Comments({ list }: { list: DailyComment[] }) {
  const { t } = useTranslation('manager')
  if (!list.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5 rounded-lg bg-sky-50 px-2 py-1 text-xs">
      {list.map((c, i) => (
        <li key={i}>
          💬 {t('reports.daily.comment', { by: c.by })}：{c.body}
        </li>
      ))}
    </ul>
  )
}

/** 管理 → レポート: one AI日報 (summary by Claude + the records of every store × 勤番 + open cases). */
export function DailyReportView({ r }: { r: AiReport & { kind: 'daily' } }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const d: DailyData = r.data
  const title = t('reports.dailyTitle', { date: `${formatShortDate(d.date)}(${t(`weekday.${weekdayOf(d.date)}`)})` })
  return (
    <article className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-xs text-muted">
            {t('reports.made', { at: jstDateTime(r.created_at) })}
            {r.mailed_at && ` ・ ${t('reports.mailed')}`}
          </p>
        </div>
        <Button variant="secondary" className="min-h-10 px-3 text-sm print:hidden" onClick={() => window.print()}>
          🖨️ {t('reports.print')}
        </Button>
      </div>
      <Card className="whitespace-pre-wrap text-[15px] leading-relaxed">
        <p className="mb-1 text-xs font-bold text-brand">🤖 {t('reports.daily.ai')}</p>
        {r.summary}
      </Card>
      <h3 className="mt-1 font-bold">{t('reports.daily.records')}</h3>
      {d.slots.map((s) => (
        <Card key={`${s.store}${s.shift}`} className="flex flex-col gap-2 text-sm break-inside-avoid">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-bold">
              {s.store} {SHIFT_JA[s.shift]}
            </h4>
            {s.bowls !== null && (
              <span className="text-xs text-slate-600">
                {s.bowls}
                {t('reports.bowlUnit')}
                {s.target ? ` / ${t('reports.daily.target', { n: s.target })}` : ''}
              </span>
            )}
          </div>
          <section>
            <p className="text-xs font-bold text-slate-600">{t('reports.daily.chorei')}</p>
            {s.chorei ? (
              <>
                <p>
                  {t('reports.daily.leader')}: <b>{s.chorei.leader ?? '—'}</b>
                  {s.chorei.participants.length > 0 && ` ／ ${t('reports.daily.participants')}: ${s.chorei.participants.join('、')}`}
                </p>
                {s.chorei.caution && (
                  <p>
                    {t('reports.daily.caution')}: {s.chorei.caution}
                  </p>
                )}
                {s.chorei.notes.map((n, i) => (
                  <p key={i} className="text-xs">
                    ＋ {n}
                  </p>
                ))}
                <Comments list={s.chorei.comments} />
              </>
            ) : s.chorei_missed?.kind === 'done' ? (
              <p>{t('reports.daily.choreiConfirmed')}</p>
            ) : s.chorei_missed ? (
              <p className="text-amber-800">
                {t('reports.daily.choreiMissed')}（{s.chorei_missed.reason ? tc(`miss.reason.${s.chorei_missed.reason}`, { ns: 'chorei' }) : '—'}
                {s.chorei_missed.note ? `：${s.chorei_missed.note}` : ''}）
              </p>
            ) : (
              <p className="text-red-700">{t('reports.daily.noRecord')}</p>
            )}
          </section>
          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-bold text-slate-600">{t('reports.daily.patrol')}</p>
            {s.patrols.length === 0 && <p className="text-slate-500">{t('reports.daily.none')}</p>}
            {s.patrols.map((p, i) => (
              <div key={i} className="rounded-lg border border-line p-2">
                <p className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-slate-600">{p.time}</span>
                  <b>{p.patroller ?? '—'}</b> → {p.staff?.join('、') || '—'}
                  <span className="ml-auto font-bold tabular-nums">
                    {p.score ?? '—'}/{p.max ?? '—'}
                  </span>
                  {p.judgement && <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', JUDGE_STYLE[p.judgement])}>{t(`reports.daily.judge.${p.judgement}`)}</span>}
                </p>
                {p.good_points && (
                  <p className="text-green-800">
                    ◎ {t('reports.daily.good')}: {p.good_points}
                  </p>
                )}
                {p.improvements && (
                  <p className="text-amber-800">
                    △ {t('reports.daily.improve')}: {p.improvements}
                  </p>
                )}
                {p.customer?.reason && (
                  <p className="text-xs">
                    {t('reports.daily.customer')}: {p.customer.reason}
                  </p>
                )}
                <Comments list={p.comments} />
              </div>
            ))}
          </section>
          {(s.attendance.length > 0 || s.incidents.length > 0) && (
            <section>
              <p className="text-xs font-bold text-slate-600">{t('reports.daily.sudden')}</p>
              {s.attendance.map((a, i) => (
                <p key={i}>
                  {t(`reports.daily.change.${a.kind}`)}: {a.name}（{tc(`change.reason.${a.reason}`, { ns: 'shift' })}
                  {a.late_min ? `・${t('reports.daily.minutes', { n: a.late_min })}` : ''}
                  {a.cover ? `・${t('reports.daily.cover', { name: a.cover })}` : ''}）
                </p>
              ))}
              {s.incidents.map((x) => (
                <p key={x.no}>
                  ⚠ {tc(`incident.kinds.${x.kind}`)} #{x.no} {x.time}：{x.description}（{tc(`wf.state.${x.state}`, { defaultValue: x.state })}）
                </p>
              ))}
            </section>
          )}
        </Card>
      ))}
      <Card className="flex flex-col gap-1 text-sm break-inside-avoid">
        <h3 className="font-bold">{t('reports.daily.open')}</h3>
        {d.open_cases.length === 0 && <p className="text-slate-500">{t('reports.daily.none')}</p>}
        {d.open_cases.map((o) => (
          <p key={o.no} className={cx(o.overdue && 'text-red-700')}>
            #{o.no} {tc(`incident.kinds.${o.kind}`)}（{o.store.replace('店', '')} {formatShortDate(o.date)}〜・{t('reports.daily.daysOpen', { n: o.days_open })}・
            {tc(`wf.state.${o.state}`, { defaultValue: o.state })}
            {o.overdue ? `・${t('reports.daily.overdue')}` : ''}
            {o.assignee ? `・${t('reports.daily.assignee', { name: o.assignee })}` : ''}）：{o.description}
          </p>
        ))}
      </Card>
    </article>
  )
}
