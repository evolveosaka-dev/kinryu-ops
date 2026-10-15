import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, Spinner, TextArea, TextInput } from '../../components/ui'
import { DateField } from '../../components/DateField'
import { readSlotPreset } from '../../domain/duty'
import {
  CASH_TYPES,
  cashSummary,
  DENOMINATIONS,
  MEALS_ENABLED,
  minutesToTime,
  NOTES_NONE,
  noodleCheck,
  parseInteger,
  signedDiff,
  STAFF_STATUS,
  targetRate,
  TICKETS,
  WATER_TIMES,
  yen,
  type CashRow,
  type CashType,
  type MealRow,
  type SalesLog,
  type SalesReport,
  type StaffRow,
  type StaffStatus,
  type TicketKind,
} from '../../domain/sales'
import { fmtQty, LOSS_REASONS, parseQty, stockState, type StockEvent, type StockItem } from '../../domain/stock'
import { currentSlot, formatShortDate, formatTokyoTime, previousSlot, tokyoParts } from '../../domain/time'
import { SHIFTS, type Shift } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { getLastStore, setLastStore } from '../../lib/lastStore'
import { useHolidays, useRoster, useSlotSchedule, useStores, useTargetEvents, useTargets } from '../../lib/queries'
import { findTarget, targetHint } from '../../domain/targets'
import type { Store } from '../../lib/types'
import { addStockEvent, itemName, useStockEvents, useStockItems } from '../stock/data'
import { TranslationCancelled, useTranslationGate, type GateField } from '../translate/useTranslationGate'
import { saveSalesReport, useSalesLog, useSalesReport } from './data'

interface Slot {
  store: Store
  date: string
  shift: Shift
}

const nowHm = () => formatTokyoTime(new Date())
const CUSTOMER = 'お客様'
// as on the paper sheet
const DENOM_LABEL: Record<number, string> = { 10000: '1万円', 5000: '5千円', 2000: '2千円', 1000: '千円' }
const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function Section({ title, children, tone }: { title: ReactNode; children: ReactNode; tone?: 'bad' | 'ok' }) {
  return (
    <Card className={cx('flex flex-col gap-3', tone === 'bad' && 'ring-2 ring-red-400', tone === 'ok' && 'ring-1 ring-green-400')}>
      <h2 className="text-[17px] font-bold">{title}</h2>
      {children}
    </Card>
  )
}

const smallInput = 'min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 text-base focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15'

function useErrorText() {
  const { t } = useTranslation('sales')
  return (err: unknown) => {
    const m = errorMessage(err)
    if (m.includes('date out of range')) return t('error.dateRange')
    if (m.includes('locked')) return t('locked')
    if (m.includes('cash difference')) return t('error.cashReason')
    if (m.includes('noodle difference')) return t('error.noodleReason')
    if (m.includes('tickets and cash')) return t('error.required')
    return `${t('common:error.generic')} (${m})`
  }
}

/** 変更の履歴 of the report. */
function History({ logs, report }: { logs: SalesLog[]; report: SalesReport | null }) {
  const { t } = useTranslation('sales')
  const [all, setAll] = useState(false)
  const shown = all ? logs : logs.slice(0, 4)
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="flex items-center justify-between font-bold">
        🕘 {t('history.title')}
        {report && (
          <span className={cx('rounded-md px-2 py-0.5 text-sm', report.status === 'submitted' ? 'bg-green-100 text-green-900' : 'bg-slate-200 text-slate-800')}>
            {report.status === 'submitted' ? t('status.submitted') : t('status.draft')}
          </span>
        )}
      </h2>
      {logs.length === 0 && <p className="text-sm text-muted">{t('history.empty')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {shown.map((l) => (
          <li key={l.id} className="flex gap-2 py-2 text-sm">
            <span className="w-24 shrink-0 font-bold tabular-nums">
              {formatShortDate(tokyoParts(new Date(l.at)).date).replace(/\(.\)/, '')} {formatTokyoTime(new Date(l.at))}
            </span>
            <span className="flex-1">
              <b>{l.author_name}</b>・{l.action === 'submit' ? `✅ ${t('history.submit')}` : t('history.save')}
              {l.sections.length > 0 && <span className="block text-slate-700">{l.sections.map((s) => t(`section.${s}`)).join('、')}</span>}
            </span>
          </li>
        ))}
      </ul>
      {logs.length > 4 && (
        <Button variant="ghost" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? t('history.showLess') : t('history.showAll', { n: logs.length })}
        </Button>
      )}
    </Card>
  )
}

/** その他払出 = 麺の廃棄・破損 from 在庫・仕入; one can be added here too. */
function NoodleLoss({ slot, noodle, losses }: { slot: Slot; noodle: StockItem; losses: { e: StockEvent; qty: number }[] }) {
  const { t } = useTranslation('sales')
  const ts = useTranslation('stock').t
  const queryClient = useQueryClient()
  const translation = useTranslationGate()
  const errorText = useErrorText()
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [noNote, setNoNote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 「その他」 always needs the details, so なし cannot apply to it
  const skipNote = noNote && reason !== 'other'
  const add = useMutation({
    mutationFn: async () => {
      const tr = await translation.prepare([{ key: 'note', label: ts('form.reasonNote'), text: skipNote ? null : note.trim() || null }])
      await addStockEvent({
        store: slot.store.id,
        date: slot.date,
        shift: slot.shift,
        kind: 'loss',
        lines: [{ item: noodle.id, qty: Number(parseQty(qty)) }],
        reason,
        note: tr.values.note ?? null,
        noteOriginal: tr.originals?.note ?? null,
        sourceLang: tr.sourceLang,
      })
    },
    onSuccess: () => {
      setOpen(false)
      setQty('')
      setReason('')
      setNote('')
      setNoNote(false)
      void queryClient.invalidateQueries({ queryKey: ['stock_events'] })
    },
  })
  const submit = () => {
    const n = parseQty(qty)
    if (typeof n !== 'number' || n <= 0) return setError(ts('form.badNumber'))
    if (!reason) return setError(ts('form.reasonRequired'))
    if (reason === 'other' && !note.trim()) return setError(ts('form.reasonNoteRequired'))
    setError(null)
    add.mutate()
  }
  return (
    <div className="flex flex-col gap-2">
      {translation.review}
      {losses.length === 0 ? (
        <p className="text-sm text-muted">{t('otherOut.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {losses.map(({ e, qty: q }) => (
            <li key={e.id} className="py-1.5">
              <b>{formatTokyoTime(new Date(e.created_at))}</b> {e.author_name}・{itemName(ts, noodle)} <b className="text-red-700">−{fmtQty(q)}</b>
              {e.reason && <span>（{ts(`reason.${e.reason}`)}）</span>}
              {e.note && <span className="block text-slate-700">📝 {e.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <TextInput label={`${itemName(ts, noodle)}（${ts(`unit.${noodle.unit}`)}）`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Segmented label={ts('form.reason')} value={reason} onChange={setReason} columns={1} options={LOSS_REASONS.map((r) => ({ value: r, label: ts(`reason.${r}`) }))} />
          <TextInput
            label={reason === 'other' ? ts('form.reasonNoteRequiredLabel') : ts('form.reasonNote')}
            value={skipNote ? '' : note}
            maxLength={200}
            disabled={skipNote}
            className="disabled:border-slate-300 disabled:bg-slate-100"
            onChange={(e) => setNote(e.target.value)}
          />
          {reason !== 'other' && (
            <Checkbox checked={noNote} onChange={setNoNote}>
              {t('otherOut.noNote')}
            </Checkbox>
          )}
          {error && <ErrorBox message={error} />}
          {add.error && !(add.error instanceof TranslationCancelled) && <ErrorBox message={errorText(add.error)} />}
          <Button onClick={submit} disabled={add.isPending}>
            {add.isPending ? t('common:action.loading') : t('otherOut.save')}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {ts('form.cancel')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          ＋ {t('otherOut.add')}
        </Button>
      )}
    </div>
  )
}

function SalesForm({
  slot,
  report,
  prevActual,
  scheduled,
  noodle,
  noodleUsed,
  noodleLosses,
  target,
  targetNote,
  locked,
}: {
  locked: boolean
  targetNote: string | null
  slot: Slot
  report: SalesReport | null
  prevActual: number | null
  scheduled: { roster_name: string; start_min: number; end_min: number }[]
  noodle: StockItem | null
  noodleUsed: number | null
  noodleLosses: { e: StockEvent; qty: number }[]
  target: number | null
}) {
  const { t } = useTranslation('sales')
  const toast = useToast()
  const queryClient = useQueryClient()
  const translation = useTranslationGate()
  const errorText = useErrorText()
  const roster = useRoster()
  const me = useMe()
  const myName = me.roster_name || me.display_name

  const [tickets, setTickets] = useState<Record<TicketKind, string>>(() => ({
    ramen: numText(report?.tickets.ramen),
    chashu: numText(report?.tickets.chashu),
    coupon: numText(report?.tickets.coupon),
  }))
  const [meals, setMeals] = useState<MealRow[]>(report?.meals ?? [])
  const [staff, setStaff] = useState<StaffRow[]>(() =>
    report?.staff.length
      ? report.staff
      : scheduled.map((s) => ({ name: s.roster_name, start: minutesToTime(s.start_min), end: minutesToTime(s.end_min), status: 'normal' as StaffStatus })),
  )
  const [book, setBook] = useState<(Omit<CashRow, 'amount'> & { amount: string })[]>(() =>
    (report?.cash_book ?? []).map((r) => ({ ...r, amount: String(r.amount) })),
  )
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(DENOMINATIONS.map((d) => [String(d), numText(report?.cash_counts[String(d)])])),
  )
  const [carriedText, setCarriedText] = useState(report?.cash_carried_manual ? numText(report.cash_carried) : '')
  const [cashReason, setCashReason] = useState(report?.cash_diff_reason ?? '')
  const [noodleReason, setNoodleReason] = useState(report?.noodle_reason ?? '')
  const [water, setWater] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(WATER_TIMES[slot.shift].map((h) => [h, ''])), ...(report?.water ?? {}) }))
  const [notesNone, setNotesNone] = useState(report?.notes === NOTES_NONE)
  const [notes, setNotes] = useState(report?.notes === NOTES_NONE ? '' : (report?.notes ?? ''))
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [error, setError] = useState<string | null>(null)
  const [addName, setAddName] = useState('')

  // ---- derived values
  const ticketNums = Object.fromEntries(TICKETS.map((k) => [k, parseInteger(tickets[k])])) as Record<TicketKind, number | undefined>
  const total = TICKETS.reduce((s, k) => s + (Number.isNaN(ticketNums[k]) ? 0 : (ticketNums[k] ?? 0)), 0)
  const rate = targetRate(total, target)
  const mealCount = MEALS_ENABLED ? meals.reduce((s, m) => s + (m.qty || 0), 0) : 0
  const lost = noodleLosses.reduce((s, l) => s + l.qty, 0)
  const check = noodleCheck(total, noodleUsed, lost, mealCount)
  const carried = prevActual ?? (parseInteger(carriedText) ?? null)
  const bookRows: CashRow[] = book.map((r) => ({ ...r, staff: r.staff ?? myName, amount: parseInteger(r.amount) ?? 0 }))
  const countNums = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, parseInteger(v)]))
  const cash = cashSummary(Number.isNaN(carried) ? null : carried, bookRows, countNums)
  const noodleBad = check !== null && check.diff !== 0
  const cashBad = cash.diff !== null && cash.diff !== 0

  const payload = () => ({
    tickets: Object.fromEntries(TICKETS.filter((k) => ticketNums[k] !== undefined).map((k) => [k, ticketNums[k]])),
    target_bowls: target,
    meals,
    staff,
    cash_book: bookRows,
    cash_counts: Object.fromEntries(Object.entries(countNums).filter(([, v]) => v !== undefined)),
    cash_carried: prevActual === null ? (parseInteger(carriedText) ?? null) : null,
    cash_diff_reason: cashReason,
    noodle_out: check?.out ?? null,
    noodle_lost: noodleUsed === null ? null : lost,
    noodle_meals: MEALS_ENABLED ? mealCount : null,
    noodle_reason: noodleReason,
    water,
    notes: notesNone ? NOTES_NONE : notes,
  })

  const validate = (forSubmit: boolean) => {
    if (TICKETS.some((k) => Number.isNaN(ticketNums[k])) || Object.values(countNums).some((v) => Number.isNaN(v)) || book.some((r) => Number.isNaN(parseInteger(r.amount))))
      return t('error.badNumber')
    if (book.some((r) => !(parseInteger(r.amount)! > 0))) return t('error.amount')
    if (book.some((r) => r.type === 'refund' && !r.reason?.trim())) return t('error.refundReason')
    if (Object.values(water).some((v) => v !== '' && !/^\d{1,5}$/.test(v.normalize('NFKC')))) return t('error.water')
    if (staff.some((s) => !s.name.trim())) return t('error.staffName')
    if (!forSubmit) return null
    if (TICKETS.every((k) => ticketNums[k] === undefined)) return t('error.tickets')
    if (cash.actual === null) return t('error.counts')
    if (carried === null || Number.isNaN(carried)) return t('error.carried')
    if (cashBad && !cashReason.trim()) return t('error.cashReason')
    if (noodleBad && !noodleReason.trim()) return t('error.noodleReason')
    return null
  }

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      // free text in another language → Japanese, confirmed by the writer
      const fields: GateField[] = [
        { key: 'notes', label: t('section.notes'), text: notesNone ? null : notes.trim() || null },
        { key: 'cash_diff_reason', label: t('cash.reason'), text: cashBad ? cashReason.trim() || null : null },
        { key: 'noodle_reason', label: t('noodle.reason'), text: noodleBad ? noodleReason.trim() || null : null },
        ...book.map((r, i) => ({ key: `refund_${i}`, label: t('book.reason'), text: r.type === 'refund' ? r.reason?.trim() || null : null })),
        ...staff.map((s, i) => ({ key: `staff_${i}`, label: t('staff.note'), text: s.note?.trim() || null })),
      ]
      const tr = await translation.prepare(fields)
      const data = payload()
      data.notes = notesNone ? NOTES_NONE : (tr.values.notes ?? '')
      data.cash_diff_reason = cashBad ? (tr.values.cash_diff_reason ?? '') : ''
      data.noodle_reason = noodleBad ? (tr.values.noodle_reason ?? '') : ''
      data.cash_book = bookRows.map((r, i) => (r.type === 'refund' ? { ...r, reason: tr.values[`refund_${i}`] ?? '' } : { ...r, reason: undefined }))
      data.staff = staff.map((s, i) => ({ ...s, note: tr.values[`staff_${i}`] ?? undefined }))
      await saveSalesReport(slot.store.id, slot.date, slot.shift, { ...data, original_texts: tr.originals, source_lang: tr.sourceLang }, submit)
      return submit
    },
    onSuccess: (submit) => {
      setLastStore(slot.store.id)
      toast(submit ? t('submitted') : t('saved'))
      void queryClient.invalidateQueries({ queryKey: ['sales_report'] })
      void queryClient.invalidateQueries({ queryKey: ['sales_report_log'] })
      window.scrollTo({ top: 0 })
    },
  })

  const run = (submit: boolean) => {
    const e = validate(submit)
    if (e) return setError(e)
    setError(null)
    if (submit && step === 'edit') {
      setStep('confirm')
      window.scrollTo({ top: 0 })
      return
    }
    save.mutate(submit)
  }

  const saveError = save.error && !(save.error instanceof TranslationCancelled) ? errorText(save.error) : null

  if (step === 'confirm') {
    const row = (label: string, value: ReactNode, bad = false) => (
      <tr className={cx('border-b border-line', bad && 'bg-red-50')}>
        <th className="py-2 pr-2 text-left font-bold">{label}</th>
        <td className={cx('py-2 text-right text-lg font-bold tabular-nums', bad && 'text-red-700')}>{value}</td>
      </tr>
    )
    return (
      <div className="flex flex-col gap-3">
        {translation.review}
        <Card className="flex flex-col gap-3 ring-2 ring-brand">
          <h2 className="text-[17px] font-bold">✅ {t('confirm.title')}</h2>
          <table className="w-full text-sm">
            <tbody>
              {row(t('confirm.tickets'), `${total}${t('unit.bowls')}${target ? `（${t('confirm.target', { target, rate })}）` : ''}`)}
              {row(t('confirm.noodle'), check ? signedDiff(check.diff, t('unit.pieces')) : t('noodle.notClosed'), noodleBad)}
              {row(t('confirm.cash'), signedDiff(cash.diff, '円'), cashBad)}
              {row(t('cash.actual'), yen(cash.actual))}
              {row(t('section.staff'), t('confirm.people', { n: staff.filter((s) => s.status !== 'absent').length }))}
            </tbody>
          </table>
          {noodleBad && <p className="text-sm">📝 {t('noodle.reason')}：{noodleReason}</p>}
          {cashBad && <p className="text-sm">📝 {t('cash.reason')}：{cashReason}</p>}
          {saveError && <ErrorBox message={saveError} />}
          <Button onClick={() => run(true)} disabled={save.isPending}>
            {save.isPending ? t('common:action.loading') : t('confirm.send')}
          </Button>
          <Button variant="secondary" onClick={() => setStep('edit')} disabled={save.isPending}>
            {t('confirm.back')}
          </Button>
        </Card>
      </div>
    )
  }

  const setStaffRow = (i: number, patch: Partial<StaffRow>) => setStaff((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setBookRow = (i: number, patch: Partial<(typeof book)[number]>) => setBook((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
      {translation.review}
      {locked && <p className="rounded-xl bg-slate-200 p-3 text-sm font-bold text-slate-800">🔒 {t('locked')}</p>}

      <Section title={`🎫 ${t('section.tickets')}`}>
        <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2 [&>div]:justify-between [&_label]:whitespace-nowrap">
          {TICKETS.map((k) => (
            <TextInput key={k} label={t(`tickets.${k}`)} inputMode="numeric" value={tickets[k]} onChange={(e) => setTickets((x) => ({ ...x, [k]: e.target.value }))} className="text-right text-lg font-bold" />
          ))}
        </div>
        <p className="flex items-baseline justify-between rounded-xl bg-surface px-3 py-2">
          <span className="font-bold">{t('tickets.total')}</span>
          <span className="text-2xl font-bold tabular-nums">
            {total}
            <span className="text-base">{t('unit.sheets')}</span>
          </span>
        </p>
        {target && target > 0 ? (
          <p className={cx('rounded-xl px-3 py-2 font-bold', rate !== null && rate >= 100 ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900')}>
            🎯 {t('tickets.target', { target, rate })}
            {targetNote && <span className="block text-xs font-normal">{targetNote}</span>}
          </p>
        ) : (
          <p className="text-sm text-muted">{t('tickets.noTarget')}</p>
        )}
      </Section>

      {MEALS_ENABLED && (
        <Section title={`🍜 ${t('section.meals')}`}>
          {meals.map((m, i) => (
            <div key={i} className="flex gap-2">
              <input className={smallInput} value={m.name} onChange={(e) => setMeals((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className={`${smallInput} w-20 text-right`} inputMode="numeric" value={m.qty || ''} onChange={(e) => setMeals((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
            </div>
          ))}
          <Button variant="secondary" onClick={() => setMeals((xs) => [...xs, { name: '', qty: 1 }])}>
            ＋ {t('meals.add')}
          </Button>
        </Section>
      )}

      {noodle && (
        <Section title={`🗑️ ${t('section.otherOut')}`}>
          <NoodleLoss slot={slot} noodle={noodle} losses={noodleLosses} />
        </Section>
      )}

      <Section title={`🍜 ${t('section.noodle')}`} tone={check === null ? undefined : noodleBad ? 'bad' : 'ok'}>
        {check === null ? (
          <div className="flex flex-col gap-2">
            <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">⚠️ {t('noodle.notClosed')}</p>
            <Link
              to={`/stock?store=${slot.store.code}&date=${slot.date}&shift=${slot.shift}`}
              className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-brand bg-white font-bold text-brand-dark"
            >
              📦 {t('noodle.toStock')}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">{t('noodle.formula')}</p>
            <p className="text-center text-xl font-bold tabular-nums">
              {total} − ({fmtQty(check.out)} − {mealCount} − {fmtQty(lost)}) = <span className={noodleBad ? 'text-red-700' : 'text-green-700'}>{signedDiff(check.diff)}</span>
            </p>
            {noodleBad && <TextArea label={`${t('noodle.reason')}（${t('required')}）`} value={noodleReason} onChange={(e) => setNoodleReason(e.target.value)} />}
          </>
        )}
      </Section>

      <Section title={`👥 ${t('section.staff')}`}>
        <p className="text-sm text-muted">{t('staff.help')}</p>
        <ul className="flex flex-col gap-2">
          {staff.map((s, i) => (
            <li key={i} className={cx('flex flex-col gap-2 rounded-xl border border-line p-2', s.status === 'absent' && 'bg-slate-100')}>
              <div className="flex items-center gap-2">
                <b className={cx('flex-1', s.status === 'absent' && 'line-through')}>{s.name}</b>
                <button type="button" aria-label={t('staff.remove')} onClick={() => setStaff((xs) => xs.filter((_, j) => j !== i))} className="min-h-10 min-w-10 rounded-lg border border-slate-300 text-slate-600">
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                <input type="time" aria-label={t('staff.start')} className={smallInput} value={s.start} onChange={(e) => setStaffRow(i, { start: e.target.value })} />
                <input type="time" aria-label={t('staff.end')} className={smallInput} value={s.end} onChange={(e) => setStaffRow(i, { end: e.target.value })} />
                <select aria-label={t('staff.status')} className={smallInput} value={s.status} onChange={(e) => setStaffRow(i, { status: e.target.value as StaffStatus })}>
                  {STAFF_STATUS.map((st) => (
                    <option key={st} value={st}>
                      {t(`staff.statuses.${st}`)}
                    </option>
                  ))}
                </select>
              </div>
              {s.status !== 'normal' && (
                <input className={smallInput} placeholder={t('staff.notePlaceholder')} value={s.note ?? ''} maxLength={200} onChange={(e) => setStaffRow(i, { note: e.target.value })} />
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <select aria-label={t('staff.add')} className={smallInput} value={addName} onChange={(e) => setAddName(e.target.value)}>
            <option value="">{t('staff.addPlaceholder')}</option>
            {(roster.data ?? [])
              .filter((r) => !staff.some((s) => s.name === r.name))
              .map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
          </select>
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={!addName}
            onClick={() => {
              setStaff((xs) => [...xs, { name: addName, start: WATER_TIMES[slot.shift][0]!, end: WATER_TIMES[slot.shift][1]!, status: 'normal' }])
              setAddName('')
            }}
          >
            ＋ {t('staff.add')}
          </Button>
        </div>
      </Section>

      <Section title={`📒 ${t('section.cash_book')}`}>
        <p className="text-sm text-muted">{t('book.help')}</p>
        {book.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-line p-2">
            <div className="grid grid-cols-[7rem_1fr_auto] gap-2">
              <input type="time" aria-label={t('book.time')} className={smallInput} value={r.time} onChange={(e) => setBookRow(i, { time: e.target.value })} />
              <select aria-label={t('book.type')} className={smallInput} value={r.type} onChange={(e) => setBookRow(i, { type: e.target.value as CashType })}>
                {CASH_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {t(`book.types.${ct}`)}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={t('staff.remove')} onClick={() => setBook((xs) => xs.filter((_, j) => j !== i))} className="min-h-11 min-w-11 rounded-lg border border-slate-300 text-slate-600">
                ✕
              </button>
            </div>
            <input className={smallInput} placeholder={t('book.detail')} value={r.detail} maxLength={200} onChange={(e) => setBookRow(i, { detail: e.target.value })} />
            <div className="flex items-center gap-2">
              <label className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2 text-sm font-bold">
                <input type="checkbox" className="size-5 accent-brand" checked={Boolean(r.customer)} onChange={(e) => setBookRow(i, { customer: e.target.checked, name: e.target.checked ? CUSTOMER : '' })} />
                {t('book.customer')}
              </label>
              {!r.customer && <input className={smallInput} placeholder={t('book.name')} value={r.name} maxLength={40} onChange={(e) => setBookRow(i, { name: e.target.value })} />}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-xs font-bold text-slate-700">
                {t('book.staff')}
                <select className={smallInput} value={r.staff ?? myName} onChange={(e) => setBookRow(i, { staff: e.target.value })}>
                  {[...new Set([myName, r.staff ?? myName, ...staff.filter((s) => s.status !== 'absent').map((s) => s.name)])].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-bold text-slate-700">
                {t('book.amount')}
                <input className={`${smallInput} text-right font-bold`} inputMode="numeric" value={r.amount} onChange={(e) => setBookRow(i, { amount: e.target.value })} />
              </label>
            </div>
            {r.type === 'refund' && (
              <input className={cx(smallInput, !r.reason?.trim() && 'border-red-500')} placeholder={t('book.reasonPlaceholder')} value={r.reason ?? ''} maxLength={300} onChange={(e) => setBookRow(i, { reason: e.target.value })} />
            )}
          </div>
        ))}
        <Button variant="secondary" onClick={() => setBook((xs) => [...xs, { time: nowHm(), type: 'out', detail: '', name: '', customer: false, staff: myName, amount: '', reason: '' }])}>
          ＋ {t('book.add')}
        </Button>
      </Section>

      <Section title={`💴 ${t('section.cash')}`} tone={cash.diff === null ? undefined : cashBad ? 'bad' : 'ok'}>
        <p className="text-sm text-muted">{t('cash.help')}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {DENOMINATIONS.map((d) => (
            <label key={d} className="flex items-center gap-1.5">
              <span className="w-[4.6rem] shrink-0 text-right text-sm font-bold whitespace-nowrap tabular-nums">{DENOM_LABEL[d] ?? `${d}円`} ×</span>
              <input inputMode="numeric" aria-label={`${d}円`} className={`${smallInput} text-right font-bold`} value={counts[String(d)]} onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value }))} />
            </label>
          ))}
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-line">
              <th className="py-1.5 text-left">{t('cash.carried')}</th>
              <td className="py-1.5 text-right tabular-nums">
                {prevActual !== null ? (
                  yen(prevActual)
                ) : (
                  <input inputMode="numeric" aria-label={t('cash.carried')} className={`${smallInput} w-32 text-right`} placeholder={t('cash.carriedManual')} value={carriedText} onChange={(e) => setCarriedText(e.target.value)} />
                )}
              </td>
            </tr>
            <tr className="border-b border-line">
              <th className="py-1.5 text-left">{t('cash.in')}</th>
              <td className="py-1.5 text-right tabular-nums">+{yen(cash.cashIn)}</td>
            </tr>
            <tr className="border-b border-line">
              <th className="py-1.5 text-left">{t('cash.out')}</th>
              <td className="py-1.5 text-right tabular-nums">−{yen(cash.cashOut)}</td>
            </tr>
            <tr className="border-b border-line">
              <th className="py-1.5 text-left">{t('cash.expected')}</th>
              <td className="py-1.5 text-right font-bold tabular-nums">{yen(cash.expected)}</td>
            </tr>
            <tr className="border-b border-line">
              <th className="py-1.5 text-left">{t('cash.actual')}</th>
              <td className="py-1.5 text-right text-lg font-bold tabular-nums">{yen(cash.actual)}</td>
            </tr>
            <tr>
              <th className="py-1.5 text-left">{t('cash.diff')}</th>
              <td className={cx('py-1.5 text-right text-lg font-bold tabular-nums', cashBad ? 'text-red-700' : 'text-green-700')}>{signedDiff(cash.diff, '円')}</td>
            </tr>
          </tbody>
        </table>
        {prevActual === null && <p className="text-xs text-muted">{t('cash.noPrevious')}</p>}
        {cashBad && <TextArea label={`${t('cash.reason')}（${t('required')}）`} value={cashReason} onChange={(e) => setCashReason(e.target.value)} />}
      </Section>

      <Section title={`📝 ${t('section.notes')}`}>
        <div className="grid grid-cols-2 gap-2">
          {WATER_TIMES[slot.shift].map((h) => (
            <TextInput key={h} label={t('water.label', { time: h.slice(0, 2) })} inputMode="numeric" maxLength={5} value={water[h] ?? ''} onChange={(e) => setWater((w) => ({ ...w, [h]: e.target.value }))} className="text-right font-bold" />
          ))}
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="text-[15px] font-bold">{t('notes.label')}</span>
          <button
            type="button"
            aria-pressed={notesNone}
            onClick={() => setNotesNone((v) => !v)}
            className={cx('min-h-11 rounded-xl border-[1.5px] px-4 font-bold', notesNone ? 'border-brand bg-brand text-white' : 'border-brand bg-white text-brand-dark')}
          >
            {notesNone ? `✓ ${t('notes.none')}` : t('notes.none')}
          </button>
        </div>
        <textarea
          aria-label={t('notes.label')}
          disabled={notesNone}
          placeholder={notesNone ? '' : t('notes.placeholder')}
          value={notesNone ? '' : notes}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-12 w-full rounded-xl border border-slate-400 bg-white px-3.5 py-2.5 text-base placeholder:text-slate-600 focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
        />
      </Section>

      {error && <ErrorBox message={error} />}
      {saveError && <ErrorBox message={saveError} />}
      {!locked && (
        <Button onClick={() => run(true)} disabled={save.isPending}>
          {report?.status === 'submitted' ? t('toConfirmAgain') : t('toConfirm')}
        </Button>
      )}
      {!locked && (
        <Button variant="secondary" onClick={() => run(false)} disabled={save.isPending}>
          {save.isPending ? t('common:action.loading') : t('saveDraft')}
        </Button>
      )}
    </fieldset>
  )
}

/** メニュー → 販売日報 (日報 page 1) for one store × date × shift. */
export function SalesPage() {
  const { t } = useTranslation('sales')
  const me = useMe()
  const { isManager } = useAuth()
  const [openedAt] = useState(() => Date.now())
  const locale = currentLocale()
  const stores = useStores()
  const holidays = useHolidays()
  const targets = useTargets()
  const targetEvents = useTargetEvents()
  const [params] = useSearchParams()
  const [preset] = useState(() => readSlotPreset(params))
  const [initial] = useState(() => (preset.date && preset.shift ? { businessDate: preset.date, shift: preset.shift } : currentSlot(new Date())))
  const [storeId, setStoreId] = useState(preset.storeCode ? '' : (getLastStore() ?? ''))
  const [date, setDate] = useState(initial.businessDate)
  const [shift, setShift] = useState<Shift>(initial.shift)

  const store = stores.data?.find((s) => s.id === storeId) ?? stores.data?.find((s) => s.code === preset.storeCode) ?? stores.data?.[0]
  const id = store?.id ?? ''
  const prev = previousSlot(date, shift)
  const report = useSalesReport(id, date, shift)
  const prevReport = useSalesReport(id, prev.businessDate, prev.shift)
  const logs = useSalesLog(report.data?.id)
  const scheduled = useSlotSchedule(id, date, shift)
  const items = useStockItems(id)
  const events = useStockEvents(id, date, shift)
  const prevEvents = useStockEvents(id, prev.businessDate, prev.shift)

  const loading = [stores, report, prevReport, items, events, prevEvents].some((q) => q.isLoading) || (scheduled.isLoading && !scheduled.isError)
  if (loading) return <Spinner />
  if (!store) return <ErrorBox message={t('common:error.generic')} />
  const error = report.error ?? prevReport.error ?? items.error ?? events.error
  if (error) return <ErrorBox message={errorMessage(error)} />

  const noodle = (items.data ?? []).find((i) => i.code === 'noodle') ?? null
  const noodleState = noodle ? stockState([noodle], events.data ?? [], prevEvents.data ?? [])[0] : undefined
  const noodleLosses = noodle
    ? (events.data ?? [])
        .filter((e) => e.kind === 'loss' && !e.voided_at)
        .flatMap((e) => e.lines.filter((l) => l.item === noodle.id).map((l) => ({ e, qty: l.qty })))
    : []
  const found = holidays.data && targets.data ? findTarget(targets.data, targetEvents.data ?? [], id, date, shift, holidays.data) : null
  const target = found?.bowls ?? null
  const targetNote = found ? targetHint(t, found) : null
  const slot: Slot = { store, date, shift }
  // after 送信: the writers may still change it for 12 hours, then managers only (also checked by the database)
  const r = report.data
  const locked =
    !isManager &&
    r?.status === 'submitted' &&
    (openedAt - new Date(r.submitted_at ?? 0).getTime() > 12 * 3600 * 1000 || !(logs.data ?? []).some((l) => l.author_id === me.id))

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={`🧾 ${t('title')}`} />
      <Card className="flex flex-col gap-3">
        <Segmented label={t('common:field.store')} value={store.id} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, locale) }))} />
        <Segmented label={t('common:field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))} />
        <DateField label={t('common:field.date')} value={date} back={isManager ? 60 : 1} onChange={setDate} />
      </Card>
      <History logs={logs.data ?? []} report={report.data ?? null} />
      <SalesForm
        key={`${id}|${date}|${shift}|${report.data?.updated_at ?? 'new'}`}
        slot={slot}
        report={report.data ?? null}
        prevActual={prevReport.data?.cash_actual ?? null}
        scheduled={scheduled.data ?? []}
        noodle={noodle}
        noodleUsed={noodleState?.used ?? null}
        noodleLosses={noodleLosses}
        target={target}
        targetNote={targetNote}
        locked={Boolean(locked)}
      />
    </div>
  )
}
