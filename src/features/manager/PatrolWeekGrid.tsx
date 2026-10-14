import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../components/Sheet'
import { Button, Card, Spinner } from '../../components/ui'
import { judgementOf, normalizedTo25 } from '../../domain/patrol'
import { ITEM_KEYS } from '../../domain/stats'
import { patrolCompletion, patrolSlots, type GridDuty, type PatrolSlot } from '../../domain/patrolGrid'
import { dateRange } from '../../domain/stats'
import { addDays, formatShortDate, formatTokyoTime, weekdayOf } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { cx } from '../../lib/cx'
import { storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { Stat } from './common'
import { JUDGE_STYLE, today, usePeople, useRecords, type AdminPatrol } from './data'

const ITEM_NAME: Record<(typeof ITEM_KEYS)[number], string> = {
  score_smile: 'smile',
  score_voice: 'voice',
  score_grooming: 'grooming',
  score_clean: 'clean',
  score_quality: 'quality',
}
const score25 = (p: AdminPatrol) => (p.total === null || p.max_total === null ? null : normalizedTo25(p.total, p.max_total))
/** Average of the patrols of a slot on 25 (one decimal). */
function slotAverage(ps: AdminPatrol[]): number | null {
  const xs = ps.map(score25).filter((x): x is number => x !== null)
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null
}

/** The patrols of one slot: who, when, total, ①〜⑤, staff on shift. */
function SlotSheet({ slot, title, onOpen, onClose }: { slot: PatrolSlot<AdminPatrol>; title: string; onOpen: (p: AdminPatrol) => void; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const people = usePeople()
  const avg = slotAverage(slot.patrols)
  return (
    <Sheet title={title} onClose={onClose}>
      {slot.patrols.length > 1 && avg !== null && (
        <p className={cx('rounded-xl p-3 text-center text-lg font-bold', JUDGE_STYLE[judgementOf(Math.round(avg), 25)])}>
          {t('patrolList.average', { n: slot.patrols.length, avg })}
        </p>
      )}
      {slot.patrols.map((p) => (
        <Card key={p.id} className="flex flex-col gap-2">
          <p className="flex items-center justify-between gap-2">
            <b>
              {people.name(p.patroller_id)}・{formatTokyoTime(new Date(p.started_at))}
            </b>
            {p.judgement && (
              <span className={`rounded-full px-2 text-sm font-bold ${JUDGE_STYLE[p.judgement] ?? ''}`}>
                {p.total}/{p.max_total} {t(`common:judgement.${p.judgement}`)}
              </span>
            )}
          </p>
          <ul className="grid grid-cols-5 gap-1 text-center text-xs">
            {ITEM_KEYS.map((k) => (
              <li key={k} className="rounded-lg bg-slate-50 p-1">
                <span className="block text-[11px] text-slate-600">{t(`patrol:items.${ITEM_NAME[k]}.name`)}</span>
                <b className="text-base">{p[k] ?? '－'}</b>
              </li>
            ))}
          </ul>
          {p.staff_names.length > 0 && (
            <p className="text-sm">
              <span className="text-slate-600">{t('patrolList.staff')}：</span>
              {p.staff_names.join('、')}
            </p>
          )}
          <Button variant="secondary" onClick={() => onOpen(p)}>
            {t('patrolList.openDetail')}
          </Button>
        </Card>
      ))}
    </Sheet>
  )
}

function useDuties(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'patrol_duties', from, to],
    queryFn: async () =>
      unwrap<GridDuty[]>(
        await supabase.from('duty_assignments').select('business_date, shift, store_id, roster_name').eq('kind', 'patrol').gte('business_date', from).lte('business_date', to),
      ),
  })
}

/** 管理 → 巡回: the last 7 days × store × shift, like 管理 → 朝礼, compared with the patrol duties. */
export function PatrolWeekGrid({ onOpen }: { onOpen: (p: AdminPatrol) => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const to = today()
  const from = addDays(to, -6)
  const { patrols, isLoading } = useRecords({ from, to })
  const duties = useDuties(from, to)
  const [open, setOpen] = useState<string | null>(null)

  if (isLoading || duties.isLoading || stores.isLoading) return <Spinner />
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const dates = dateRange(from, to)
  const slots = patrolSlots(dates, storeIds, patrols.data ?? [], duties.data ?? [], new Date())
  const total = patrolCompletion(slots)
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const keyOf = (x: { date: string; storeId: string; shift: string }) => `${x.date}|${x.storeId}|${x.shift}`
  const openSlot = slots.find((x) => keyOf(x) === open) ?? null
  const avgCell = (slot: PatrolSlot<AdminPatrol>, title: string | undefined) => {
    const avg = slotAverage(slot.patrols)
    return (
      <button
        type="button"
        title={title}
        onClick={() => setOpen(keyOf(slot))}
        className={cx(
          'flex min-h-9 w-full flex-col items-center justify-center rounded font-bold underline',
          avg === null ? 'bg-green-100 text-green-900' : JUDGE_STYLE[judgementOf(Math.round(avg), 25)],
        )}
      >
        {avg ?? '✓'}
        {slot.patrols.length > 1 && <span className="text-[10px] leading-none font-normal">×{slot.patrols.length}</span>}
      </button>
    )
  }

  return (
    <Card className="flex flex-col gap-2 p-2">
      <h2 className="px-1 font-bold">{t('patrolList.weekTitle')}</h2>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t('patrolList.rate')} value={total.rate === null ? '—' : `${total.rate}%`} sub={`${total.done}/${total.due}`} />
        <Stat label={t('patrolList.missed')} value={total.missed} tone={total.missed > 0 ? 'warn' : 'good'} />
        <Stat label={t('patrolList.extra')} value={total.extra} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-center text-xs">
          <thead>
            <tr>
              <th />
              {storeIds.map((sid) => (
                <th key={sid} colSpan={3} className="border-l border-slate-200 py-1">
                  {short(sid)}
                </th>
              ))}
            </tr>
            <tr className="text-slate-600">
              <th />
              {storeIds.flatMap((sid) =>
                SHIFTS.map((s, i) => (
                  <th key={`${sid}-${s}`} className={cx('py-1 font-normal', i === 0 && 'border-l border-slate-200')}>
                    {t(`common:shift.${s}`)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-slate-100">
                <th className="py-1 text-left font-normal whitespace-nowrap">
                  {formatShortDate(d)}({t(`weekday.${weekdayOf(d)}`)})
                </th>
                {storeIds.flatMap((sid) =>
                  SHIFTS.map((shift, i) => {
                    const slot = slots.find((x) => x.date === d && x.storeId === sid && x.shift === shift)!
                    const duty = slot.dutyNames.length ? `${t('patrolList.duty')}: ${slot.dutyNames.join('、')}` : undefined
                    return (
                      <td key={`${sid}-${shift}`} className={cx('align-middle', i === 0 && 'border-l border-slate-200')}>
                        {slot.state === 'done' ? (
                          avgCell(slot, duty)
                        ) : slot.state === 'progress' ? (
                          <button type="button" title={t('patrolList.inProgress')} onClick={() => onOpen(slot.patrols[0]!)} className="min-h-8 w-full rounded bg-slate-100 font-bold text-slate-600">
                            …
                          </button>
                        ) : slot.state === 'missed' ? (
                          <span title={duty} className="block min-h-8 rounded bg-red-50 py-2 font-bold text-red-700">
                            ✗
                          </span>
                        ) : slot.state === 'planned' ? (
                          <span title={duty} className="block min-h-8 py-2 font-bold text-sky-700">
                            {t('patrolList.plannedShort')}
                          </span>
                        ) : (
                          <span className="text-slate-300">―</span>
                        )}
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-left text-xs text-slate-600">{t('patrolList.legend')}</p>
      {openSlot && (
        <SlotSheet
          slot={openSlot}
          title={`${formatShortDate(openSlot.date)}(${t(`weekday.${weekdayOf(openSlot.date)}`)}) ${short(openSlot.storeId)} ${t(`common:shift.${openSlot.shift}`)}`}
          onClose={() => setOpen(null)}
          onOpen={(p) => {
            setOpen(null)
            onOpen(p)
          }}
        />
      )}
    </Card>
  )
}
