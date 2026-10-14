import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../components/Sheet'
import { formatShortDate, formatTokyoTime, weekdayOf } from '../../domain/time'
import { MISS_ICON } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { ChoreiMissSheet } from './ChoreiMissSheet'
import { JUDGE_STYLE, usePeople, type AdminPatrol } from './data'
import { ChoreiDetail, PatrolDetail } from './details'
import { keyOf, type ChoreiSlot, type useDrill } from './drillState'

// 管理: every figure opens the records it was counted from (tap a row to see / correct it).


/** A number (Stat) that opens its list when tapped. */
export function TapStat({ label, value, sub, tone, onOpen }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad'; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="relative rounded-2xl border border-line bg-white p-3 text-left active:bg-slate-50">
      <span className="absolute top-2 right-2.5 text-xs font-bold text-brand">›</span>
      <span className="block pr-3 text-xs font-bold text-slate-600">{label}</span>
      <span className={cx('block text-2xl font-bold', tone === 'good' && 'text-green-700', tone === 'warn' && 'text-amber-700', tone === 'bad' && 'text-red-700')}>
        {value}
      </span>
      {sub && <span className="block text-xs text-slate-600">{sub}</span>}
    </button>
  )
}

/** A number inside a table or a tile that opens its list. */
export function TapNum({ onOpen, children, className }: { onOpen: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onOpen} className={cx('min-h-8 rounded px-1 underline decoration-dotted underline-offset-2 active:bg-slate-100', className)}>
      {children}
    </button>
  )
}

function Head({ how, count }: { how?: string; count: number }) {
  const { t } = useTranslation('manager')
  return (
    <>
      {how && <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold whitespace-pre-line text-sky-900">{how}</p>}
      <p className="text-sm text-slate-600">
        {t('drill.count', { n: count })} ・ {t('drill.tapRow')}
      </p>
    </>
  )
}

/** One 朝礼 slot: a record opens its detail, a slot without a record opens the ✗ / reason / ✓確認 sheet. */
export function ChoreiSlotSheets({ slot, onClose }: { slot: ChoreiSlot; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  const store = stores.data?.find((s) => s.id === slot.storeId)
  if (slot.record) return <ChoreiDetail record={slot.record} leaderName={people.name(slot.record.leader_id)} onClose={onClose} />
  return (
    <ChoreiMissSheet
      slot={slot}
      storeCode={store?.code ?? ''}
      title={`${slot.date} ${t(`common:shift.${slot.shift}`)} ${storeName(store, currentLocale())}`}
      reporterName={people.name}
      onClose={onClose}
    />
  )
}

/** State of a 朝礼 slot as a short coloured label. */
function SlotState({ slot }: { slot: ChoreiSlot }) {
  const { t } = useTranslation('manager')
  if (slot.record) return <span className="font-bold text-green-700">✓ {formatTokyoTime(new Date(slot.record.submitted_at))}</span>
  if (slot.state === 'done') return <span className="font-bold text-teal-800">✓ {t('misses.confirmedShort')}</span>
  if (slot.miss?.reason)
    return (
      <span className="font-bold text-amber-900">
        {MISS_ICON[slot.miss.reason]} {t(`chorei:miss.reason.${slot.miss.reason}`)}
      </span>
    )
  return <span className="font-bold text-red-700">✗ {t('misses.unreported')}</span>
}

/**
 * The 朝礼 slots behind a number. The slots come from the page's data, so a correction made here
 * (reason, ✓確認, 後から記録) shows in the list right away.
 */
export function ChoreiSlotList({ title, how, slots, extra, onClose }: { title: string; how?: string; slots: ChoreiSlot[]; extra?: (s: ChoreiSlot) => ReactNode; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  const [open, setOpen] = useState<string | null>(null)
  const openSlot = slots.find((s) => keyOf(s) === open) ?? null
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())
  return (
    <Sheet title={title} onClose={onClose}>
      <Head how={how} count={slots.length} />
      <ul className="flex flex-col gap-1.5">
        {slots.map((s) => (
          <li key={keyOf(s)}>
            <button type="button" onClick={() => setOpen(keyOf(s))} className="flex w-full flex-col gap-0.5 rounded-xl border border-line bg-white p-2.5 text-left text-sm active:bg-slate-50">
              <span className="flex items-center justify-between gap-2">
                <b>
                  {formatShortDate(s.date)}({t(`weekday.${weekdayOf(s.date)}`)}) {short(s.storeId)} {t(`common:shift.${s.shift}`)}
                </b>
                <SlotState slot={s} />
              </span>
              {s.record && (
                <span className="text-xs text-slate-600">
                  {t('drill.leader')}: {people.name(s.record.leader_id)}
                  {s.record.participants_extra.length > 0 && ` ・ ${t('drill.participants')}: ${s.record.participants_extra.join('、')}`}
                </span>
              )}
              {s.miss?.note && <span className="text-xs text-slate-600">{s.miss.note}</span>}
              {extra?.(s)}
            </button>
          </li>
        ))}
      </ul>
      {openSlot && <ChoreiSlotSheets key={open} slot={openSlot} onClose={() => setOpen(null)} />}
    </Sheet>
  )
}

/** The 巡回 behind a number; `extra` adds a line (e.g. the item score that was averaged). */
export function PatrolList({ title, how, patrols, extra, onClose }: { title: string; how?: string; patrols: AdminPatrol[]; extra?: (p: AdminPatrol) => ReactNode; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  const [open, setOpen] = useState<string | null>(null)
  const openPatrol = patrols.find((p) => p.id === open) ?? null
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())
  return (
    <Sheet title={title} onClose={onClose}>
      <Head how={how} count={patrols.length} />
      <ul className="flex flex-col gap-1.5">
        {patrols.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(p.id)}
              className={cx('flex w-full flex-col gap-0.5 rounded-xl border border-line bg-white p-2.5 text-left text-sm active:bg-slate-50', p.status === 'void' && 'opacity-50')}
            >
              <span className="flex items-center justify-between gap-2">
                <b>
                  {formatShortDate(p.business_date)}({t(`weekday.${weekdayOf(p.business_date)}`)}) {short(p.store_id)} {t(`common:shift.${p.shift}`)}
                </b>
                {p.judgement && (
                  <span className={`shrink-0 rounded-full px-2 text-xs font-bold ${JUDGE_STYLE[p.judgement] ?? ''}`}>
                    {p.total}/{p.max_total} {t(`common:judgement.${p.judgement}`)}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-600">
                {people.name(p.patroller_id)} ・ {t(`patrol:type.${p.patrol_type}`)} ・ {formatTokyoTime(new Date(p.started_at))}（{p.duration_min ?? '—'}
                {t('detail.min')}）{p.mask_worn && ' ・ 😷'}
              </span>
              {p.staff_names.length > 0 && (
                <span className="text-xs text-slate-600">
                  {t('patrolList.staff')}: {p.staff_names.join('、')}
                </span>
              )}
              {extra?.(p)}
            </button>
          </li>
        ))}
      </ul>
      {openPatrol && <PatrolDetail patrol={openPatrol} patrollerName={people.name(openPatrol.patroller_id)} onClose={() => setOpen(null)} />}
    </Sheet>
  )
}

/**
 * The open list. Its rows were chosen when it opened; each row is shown with the page's current
 * data (`slots` / `patrols`, by key / id), so a correction made from the list shows at once.
 */
export function DrillSheet({ drill, slots = [], patrols = [] }: { drill: ReturnType<typeof useDrill>; slots?: ChoreiSlot[]; patrols?: AdminPatrol[] }) {
  if (!drill.current) return null
  const d = drill.current
  if (d.kind === 'chorei') {
    const fresh = new Map(slots.map((s) => [keyOf(s), s]))
    return <ChoreiSlotList title={d.title} how={d.how} slots={d.slots.map((s) => fresh.get(keyOf(s)) ?? s)} extra={d.extra} onClose={drill.close} />
  }
  const fresh = new Map(patrols.map((p) => [p.id, p]))
  return <PatrolList title={d.title} how={d.how} patrols={d.patrols.map((p) => fresh.get(p.id) ?? p)} extra={d.extra} onClose={drill.close} />
}
