import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner, TextInput } from '../../components/ui'
import { DateField } from '../../components/DateField'
import { readSlotPreset } from '../../domain/duty'
import type { PreparedMedia } from '../../lib/media'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import {
  fmtQty,
  IN_PLACES,
  latestTemps,
  LOSS_REASONS,
  OPEN_REASONS,
  OUT_PLACES,
  packsOf,
  parseQty,
  parseTemp,
  stockState,
  usedOf,
  type ItemState,
  type LineKind,
  type StockEvent,
  type StockItem,
} from '../../domain/stock'
import { currentSlot, formatShortDate, formatTokyoTime, previousSlot } from '../../domain/time'
import { SHIFTS, type Shift } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { getLastStore, setLastStore } from '../../lib/lastStore'
import { useStores } from '../../lib/queries'
import type { Store } from '../../lib/types'
import { addStockEvent, itemName, replaceStockEvent, useStockEvents, useStockItems, useStockPhotos, voidStockEvent } from './data'

type Mode = LineKind | 'temp' | 'recount'
interface Slot {
  store: Store
  date: string
  shift: Shift
}

const signed = (kind: LineKind, n: number) => (kind === 'in' ? `+${fmtQty(n)}` : kind === 'out' || kind === 'loss' ? `−${fmtQty(n)}` : fmtQty(n))

function useErrorText() {
  const { t } = useTranslation('stock')
  return (err: unknown) => {
    const m = errorMessage(err)
    if (m.includes('date out of range')) return t('form.dateRange')
    if (m.includes('count every item')) return t('form.enterAll')
    return `${t('common:error.generic')} (${m})`
  }
}

/** Item name + unit (+ 1段 = 50個). */
function ItemLabel({ item, standard = false }: { item: StockItem; standard?: boolean }) {
  const { t } = useTranslation('stock')
  const unit = t(`unit.${item.unit}`)
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-bold">{itemName(t, item)}</span>
      <span className="text-xs text-muted">
        {unit}
        {item.pack_size && item.pack_unit ? `・${t('packHint', { pack: t(`pack.${item.pack_unit}`), size: fmtQty(item.pack_size), unit })}` : ''}
        {standard && item.standard !== null ? `・${t('standard', { n: fmtQty(item.standard) })}` : ''}
      </span>
    </span>
  )
}

function Table({ head, rows }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[]; tone?: 'bad' }[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-line text-xs text-slate-700">
            {head.map((h, i) => (
              <th key={i} className={cx('px-1 py-1.5 font-bold', i === 0 ? 'text-left' : 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cx('border-b border-line', r.tone === 'bad' && 'bg-red-50')}>
              {r.cells.map((c, i) => (
                <td key={i} className={cx('px-1 py-2 align-top tabular-nums', i === 0 ? 'text-left' : 'text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function placeLabel(t: (k: string) => string, e: StockEvent) {
  return e.place ? `（${e.kind === 'in' ? t('form.fromShort') : t('form.toShort')}${t(`place.${e.place}`)}）` : ''
}

/** 変更の履歴 at the top: who wrote what and when; the writer (12 h) or a manager can cancel. */
function History({ events, items, onEdit }: { events: StockEvent[]; items: StockItem[]; onEdit: (e: StockEvent) => void }) {
  const { t } = useTranslation('stock')
  const me = useMe()
  const { isManager } = useAuth()
  const toast = useToast()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [all, setAll] = useState(false)
  const [openedAt] = useState(() => Date.now())
  const byId = new Map(items.map((i) => [i.id, i]))
  const cancel = useMutation({
    mutationFn: voidStockEvent,
    onSuccess: () => {
      toast(t('history.cancelled'))
      void queryClient.invalidateQueries({ queryKey: ['stock_events'] })
    },
  })
  const shown = all ? events : events.slice(0, 4)
  const photos = useStockPhotos(events.filter((e) => e.kind === 'loss').map((e) => e.id))
  const canVoid = (e: StockEvent) =>
    !e.voided_at && (isManager || (e.author_id === me.id && openedAt - new Date(e.created_at).getTime() < 12 * 3600 * 1000))

  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-bold">🕘 {t('history.title')}</h2>
      {events.length === 0 && <p className="text-sm text-muted">{t('history.empty')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {shown.map((e) => (
          <li key={e.id} className="flex items-start gap-2 py-2 text-sm">
            <span className="w-11 shrink-0 font-bold tabular-nums">{formatTokyoTime(new Date(e.created_at))}</span>
            <span className={cx('flex min-w-0 flex-1 flex-col gap-0.5', e.voided_at && 'text-slate-500 line-through')}>
              <span>
                {(e.kind === 'open' || e.kind === 'loss') && '⚠️ '}
                <b>{e.author_name}</b>・{t(`kind.${e.kind}`)}
                {placeLabel(t, e)}
                {e.reason && <b className="text-amber-900">（{t(`reason.${e.reason}`)}）</b>}
                {e.edited_by_name && <span className="text-xs text-blue-800">（{t('history.editedBy', { name: e.edited_by_name })}）</span>}
              </span>
              {e.temps ? (
                <span>{e.temps.map((x) => `${fmtQty(x)}℃`).join(' / ')}</span>
              ) : (
                <span className="text-slate-700">
                  {e.lines
                    .map((l) => {
                      const it = byId.get(l.item)
                      return `${it ? itemName(t, it) : '?'} ${signed(e.kind as LineKind, l.qty)}`
                    })
                    .join('、')}
                </span>
              )}
              {e.note && <span className="text-slate-700">📝 {e.note}</span>}
              {(photos.data?.get(e.id)?.length ?? 0) > 0 && (
                <span className="flex flex-wrap gap-2 text-slate-700">
                  {photos.data!.get(e.id)!.map((a, i) =>
                    a.drive_url ? (
                      <a key={i} href={a.drive_url} target="_blank" rel="noreferrer" className="font-bold text-brand underline">
                        {a.kind === 'video' ? '🎥' : '📷'} {i + 1}
                      </a>
                    ) : (
                      <span key={i}>{a.kind === 'video' ? '🎥' : '📷'} {t('photoUploading')}</span>
                    ),
                  )}
                </span>
              )}
            </span>
            {e.voided_at ? (
              <span className="shrink-0 text-xs font-bold text-slate-600">{t('history.voided', { name: e.voided_by_name })}</span>
            ) : (
              <span className="flex shrink-0 flex-col gap-1">
                {isManager && !e.temps && (
                  <button type="button" onClick={() => onEdit(e)} className="min-h-9 rounded-lg border border-blue-300 px-2 text-xs font-bold text-blue-800">
                    ✏️ {t('history.edit')}
                  </button>
                )}
                {canVoid(e) && (
                  <button
                    type="button"
                    disabled={cancel.isPending}
                    onClick={() => window.confirm(t('history.voidConfirm')) && cancel.mutate(e.id)}
                    className="min-h-9 rounded-lg border border-red-300 px-2 text-xs font-bold text-red-700"
                  >
                    {t('history.void')}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {cancel.error && <ErrorBox message={errorText(cancel.error)} />}
      {events.length > 4 && (
        <Button variant="ghost" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? t('history.showLess') : t('history.showAll', { n: events.length })}
        </Button>
      )}
    </Card>
  )
}

/** The current state: before 終わりの在庫 → 今 + 補充の目安; after → 残り + 使用. */
function StateTable({ states }: { states: ItemState[] }) {
  const { t } = useTranslation('stock')
  const closed = states.some((s) => s.left !== null)
  const anyLoss = states.some((s) => s.lost > 0)
  const head = [
    t('table.item'),
    t('table.carried'),
    t('table.in'),
    t('table.out'),
    ...(anyLoss ? [t('table.loss')] : []),
    ...(closed ? [t('table.left'), t('table.used')] : [t('table.now'), t('table.suggest')]),
  ]
  return (
    <Table
      head={head}
      rows={states.map((s) => ({
        key: s.item.id,
        tone: s.used !== null && s.used < 0 ? 'bad' : undefined,
        cells: [
          <ItemLabel item={s.item} standard />,
          <>
            {fmtQty(s.opening)}
            {s.recounted && <span title={t('recounted')}>✎</span>}
          </>,
          s.received ? `+${fmtQty(s.received)}` : '',
          s.sent ? `−${fmtQty(s.sent)}` : '',
          ...(anyLoss ? [s.lost ? <span className="font-bold text-red-700">−{fmtQty(s.lost)}</span> : ''] : []),
          ...(closed
            ? [fmtQty(s.left), <b className={cx(s.used !== null && s.used < 0 && 'text-red-700')}>{fmtQty(s.used)}</b>]
            : [
                <b>{fmtQty(s.now)}</b>,
                s.suggestion !== null ? (
                  <span className="flex flex-col items-end font-bold text-amber-800">
                    +{fmtQty(s.suggestion)}
                    {packsOf(s.suggestion, s.item) !== null && (
                      <span className="text-xs font-normal">{t('about', { n: packsOf(s.suggestion, s.item), pack: t(`pack.${s.item.pack_unit}`) })}</span>
                    )}
                  </span>
                ) : (
                  ''
                ),
              ]),
        ],
      }))}
    />
  )
}

/** 受入 / 払出 / 繰越を数え直す / 終わりの在庫: type the numbers → 確認 → 記録. */
function EntryForm({
  kind,
  slot,
  states,
  initialReason = '',
  replacing,
  onDone,
}: {
  kind: LineKind
  slot: Slot
  states: ItemState[]
  initialReason?: string
  /** 管理者が修正: the row whose figures are replaced (states are worked out without it) */
  replacing?: StockEvent
  onDone: () => void
}) {
  const { t } = useTranslation('stock')
  const toast = useToast()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const uploads = useUploadQueue()
  const translation = useTranslationGate()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((replacing?.lines ?? []).map((l) => [l.item, String(l.qty)])))
  const reasons: readonly string[] = kind === 'open' ? OPEN_REASONS : kind === 'loss' ? LOSS_REASONS : []
  const [reason, setReason] = useState<string>(replacing?.reason ?? initialReason)
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const places = (kind === 'in' ? IN_PLACES : kind === 'out' ? OUT_PLACES : []).filter((p) => p !== slot.store.code)
  const [place, setPlace] = useState<string>(replacing?.place ?? places[0] ?? '')
  const [note, setNote] = useState(replacing?.note ?? '')
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [error, setError] = useState<string | null>(null)
  const everyItem = kind === 'close'
  // 受入 / 払出 / 廃棄 move stock: an empty box or 0 = not this item
  const moves = kind === 'in' || kind === 'out' || kind === 'loss'

  const parsed = states.map((s) => ({ s, qty: parseQty(values[s.item.id] ?? '') }))
  const entered = parsed.filter((p): p is { s: ItemState; qty: number } => typeof p.qty === 'number' && (!moves || p.qty > 0))

  const toConfirm = () => {
    if (parsed.some((p) => p.qty === undefined)) return setError(t('form.badNumber'))
    if (everyItem && entered.length < states.length) return setError(t('form.enterAll'))
    if (!everyItem && entered.length === 0) return setError(t('form.enterOne'))
    if (reasons.length && !reason) return setError(t('form.reasonRequired'))
    if (reason === 'other' && !note.trim()) return setError(t('form.reasonNoteRequired'))
    if (kind === 'out' && place === 'other' && !note.trim()) return setError(t('form.noteRequired'))
    setError(null)
    setStep('confirm')
    window.scrollTo({ top: 0 })
  }

  const save = useMutation({
    mutationFn: async () => {
      // a reason memo in another language is translated to Japanese (the writer confirms it)
      const unchanged = replacing && (note.trim() || null) === (replacing.note ?? null)
      const tr =
        reasons.length && !unchanged
          ? await translation.prepare([{ key: 'note', label: t('form.reasonNote'), text: note.trim() || null }])
          : { values: { note: note.trim() || null }, originals: unchanged && replacing.note_original ? { note: replacing.note_original } : null, sourceLang: null }
      if (replacing) {
        await replaceStockEvent({
          id: replacing.id,
          lines: entered.map((p) => ({ item: p.s.item.id, qty: p.qty })),
          place: places.length ? place : null,
          note: tr.values.note ?? null,
          reason: reasons.length ? reason : null,
          noteOriginal: tr.originals?.note ?? null,
          sourceLang: tr.sourceLang,
        })
        return
      }
      const id = await addStockEvent({
        store: slot.store.id,
        date: slot.date,
        shift: slot.shift,
        kind,
        lines: entered.map((p) => ({ item: p.s.item.id, qty: p.qty })),
        place: places.length ? place : null,
        note: tr.values.note ?? null,
        reason: reasons.length ? reason : null,
        noteOriginal: tr.originals?.note ?? null,
        sourceLang: tr.sourceLang,
      })
      // photos / videos go to Google Drive in the background (queued, retried)
      if (kind === 'loss' && media.length) await uploads.enqueue('stock', id, media)
    },
    onSuccess: () => {
      setLastStore(slot.store.id)
      toast(t('form.saved'))
      void queryClient.invalidateQueries({ queryKey: ['stock_events'] })
      onDone()
    },
  })

  const confirmRows = () => {
    if (kind === 'close') {
      const anyLoss = entered.some(({ s }) => s.lost > 0)
      return {
        head: [t('table.item'), t('table.carried'), t('table.in'), t('table.out'), ...(anyLoss ? [t('table.loss')] : []), t('table.left'), t('table.used')],
        rows: entered.map(({ s, qty }) => {
          const used = usedOf(s, qty)
          return {
            key: s.item.id,
            tone: used !== null && used < 0 ? ('bad' as const) : undefined,
            cells: [
              <ItemLabel item={s.item} />,
              fmtQty(s.opening),
              s.received ? `+${fmtQty(s.received)}` : '',
              s.sent ? `−${fmtQty(s.sent)}` : '',
              ...(anyLoss ? [s.lost ? `−${fmtQty(s.lost)}` : ''] : []),
              <b>{fmtQty(qty)}</b>,
              <b className={cx('text-base', used !== null && used < 0 ? 'text-red-700' : 'text-brand-dark')}>{fmtQty(used)}</b>,
            ],
          }
        }),
      }
    }
    if (kind === 'open') {
      return {
        head: [t('table.item'), t('table.previous'), t('table.counted'), t('table.diff')],
        rows: entered.map(({ s, qty }) => {
          const diff = s.carried === null ? null : qty - s.carried
          return {
            key: s.item.id,
            cells: [<ItemLabel item={s.item} />, fmtQty(s.carried), <b>{fmtQty(qty)}</b>, diff ? `${diff > 0 ? '+' : '−'}${fmtQty(Math.abs(diff))}` : ''],
          }
        }),
      }
    }
    return {
      head: [t('table.item'), t(`table.${kind}`), t('table.now'), t(kind === 'in' ? 'table.afterIn' : kind === 'loss' ? 'table.afterLoss' : 'table.afterOut')],
      rows: entered.map(({ s, qty }) => ({
        key: s.item.id,
        cells: [
          <ItemLabel item={s.item} />,
          <b className="text-base">{signed(kind, qty)}</b>,
          fmtQty(s.now),
          <b>{s.now === null ? '—' : fmtQty(s.now + (kind === 'in' ? qty : -qty))}</b>,
        ],
      })),
    }
  }

  if (step === 'confirm') {
    const table = confirmRows()
    const negative = kind === 'close' && entered.some(({ s, qty }) => (usedOf(s, qty) ?? 0) < 0)
    const unknown = kind === 'close' && entered.some(({ s }) => s.opening === null)
    return (
      <div className="flex flex-col gap-3">
        {translation.review}
        <PageTitle title={replacing ? `✏️ ${t(`form.${kind}`)}` : t(`form.${kind}`)} subtitle={slotText(t, slot)} />
        <Card className="flex flex-col gap-3 ring-2 ring-brand">
          <h2 className="text-[17px] font-bold">✅ {t('form.confirmTitle')}</h2>
          {places.length > 0 && (
            <p className="font-bold">
              {kind === 'in' ? t('form.from') : t('form.to')}：{t(`place.${place}`)}
              {note.trim() && <span className="ml-3 font-normal">📝 {note.trim()}</span>}
            </p>
          )}
          {reasons.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 font-bold text-amber-900">
              {t('form.reason')}：{t(`reason.${reason}`)}
              {note.trim() && <span className="block font-normal">📝 {note.trim()}</span>}
            </p>
          )}
          <Table head={table.head} rows={table.rows} />
          {kind === 'loss' && media.length > 0 && <p className="text-sm">{t('form.photoCount', { n: media.length })}</p>}
          {kind === 'close' && <p className="text-sm text-muted">{t('form.usedFormula')}</p>}
          {negative && <ErrorBox message={t('form.negative')} />}
          {unknown && <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">{t('form.unknownOpening')}</p>}
          {save.error && !(save.error instanceof TranslationCancelled) && <ErrorBox message={errorText(save.error)} />}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common:action.loading') : t('form.save')}
          </Button>
          <Button variant="secondary" onClick={() => setStep('edit')} disabled={save.isPending}>
            {t('form.back')}
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <PageTitle title={replacing ? `✏️ ${t(`form.${kind}`)}` : t(`form.${kind}`)} subtitle={slotText(t, slot)} />
      {replacing ? (
        <p className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-900">
          {t('form.editHelp', { name: replacing.author_name, time: formatTokyoTime(new Date(replacing.created_at)) })}
        </p>
      ) : (
        <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{t(`form.${kind}Help`)}</p>
      )}
      {reasons.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Segmented label={`${t('form.reason')}（${t('form.required')}）`} value={reason} onChange={setReason} columns={1} options={reasons.map((r) => ({ value: r, label: t(`reason.${r}`) }))} />
          <TextInput
            label={reason === 'other' ? t('form.reasonNoteRequiredLabel') : t('form.reasonNote')}
            placeholder={t('form.reasonNotePlaceholder')}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </Card>
      )}
      {places.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Segmented
            label={kind === 'in' ? t('form.from') : t('form.to')}
            value={place}
            onChange={setPlace}
            columns={2}
            options={places.map((p) => ({ value: p, label: t(`place.${p}`) }))}
          />
          <TextInput
            label={kind === 'out' && place === 'other' ? t('form.noteOther') : t('form.note')}
            placeholder={kind === 'out' && place === 'other' ? t('form.noteOtherPlaceholder') : t('form.notePlaceholder')}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </Card>
      )}
      <Card className="flex flex-col p-0">
        <ul className="divide-y divide-line">
          {parsed.map(({ s, qty }) => (
            <li key={s.item.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <ItemLabel item={s.item} />
                {t(`hint.${s.item.code}`, { defaultValue: '' }) && (kind === 'in' || everyItem) && (
                  <span className="text-xs text-red-700">※ {t(`hint.${s.item.code}`)}</span>
                )}
                {kind === 'in' && s.suggestion !== null && (
                  <span className="text-xs font-bold text-amber-800">
                    {t('form.suggestion', { n: fmtQty(s.suggestion), unit: t(`unit.${s.item.unit}`) })}
                  </span>
                )}
                {(kind === 'out' || kind === 'loss' || kind === 'open') && s.now !== null && (
                  <span className="text-xs text-muted">{t(kind === 'open' ? 'form.carriedIs' : 'form.nowIs', { n: fmtQty(kind === 'open' ? s.opening : s.now) })}</span>
                )}
              </span>
              <input
                inputMode="decimal"
                aria-label={itemName(t, s.item)}
                value={values[s.item.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [s.item.id]: e.target.value }))}
                className={cx(
                  'min-h-12 w-24 shrink-0 rounded-xl border bg-white px-3 text-right text-lg font-bold focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none',
                  qty === undefined ? 'border-red-500' : 'border-slate-400',
                )}
              />
            </li>
          ))}
        </ul>
      </Card>
      {kind === 'loss' && !replacing && <AttachmentPicker value={media} onChange={setMedia} hint={t('form.photoHint')} />}
      {error && <ErrorBox message={error} />}
      <Button onClick={toConfirm}>{t('form.toConfirm')}</Button>
      <Button variant="secondary" onClick={onDone}>
        {t('form.cancel')}
      </Button>
    </div>
  )
}

function slotText(t: (k: string) => string, slot: Slot) {
  return `${formatShortDate(slot.date)} ${t(`common:shift.${slot.shift}`)}・${storeName(slot.store, currentLocale())}`
}

/** 冷蔵庫温度 (始め / 終わり), one value per fridge from the left. */
function TempForm({ slot, events, onDone }: { slot: Slot; events: StockEvent[]; onDone: () => void }) {
  const { t } = useTranslation('stock')
  const toast = useToast()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const count = slot.store.fridge_count ?? 0
  const [phase, setPhase] = useState<'temp_start' | 'temp_end'>(latestTemps(events, 'temp_start') ? 'temp_end' : 'temp_start')
  const [values, setValues] = useState<string[]>(() => Array.from({ length: count }, () => ''))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (temps: number[]) => addStockEvent({ store: slot.store.id, date: slot.date, shift: slot.shift, kind: phase, temps }),
    onSuccess: () => {
      toast(t('form.saved'))
      void queryClient.invalidateQueries({ queryKey: ['stock_events'] })
      onDone()
    },
  })
  const submit = () => {
    const temps = values.map(parseTemp)
    if (temps.some((x) => x === undefined || x === null)) return setError(t('temp.enterAll'))
    setError(null)
    save.mutate(temps as number[])
  }
  return (
    <div className="flex flex-col gap-3">
      <PageTitle title={`🌡️ ${t('temp.title')}`} subtitle={slotText(t, slot)} />
      <Card className="flex flex-col gap-3">
        <Segmented label={t('temp.phase')} value={phase} onChange={setPhase} options={[{ value: 'temp_start', label: t('temp.start') }, { value: 'temp_end', label: t('temp.end') }]} />
        <p className="text-sm text-muted">{t('temp.help')}</p>
        <div className="grid grid-cols-2 gap-3">
          {values.map((v, i) => (
            <TextInput
              key={i}
              label={t('temp.fridge', { n: i + 1 })}
              inputMode="decimal"
              value={v}
              onChange={(e) => setValues((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
              className="text-right text-lg font-bold"
            />
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        {save.error && <ErrorBox message={errorText(save.error)} />}
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? t('common:action.loading') : t('form.saveTemp')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('form.cancel')}
        </Button>
      </Card>
    </div>
  )
}

function TempSummary({ events, onEdit }: { events: StockEvent[]; onEdit: () => void }) {
  const { t } = useTranslation('stock')
  const row = (kind: 'temp_start' | 'temp_end') => {
    const e = latestTemps(events, kind)
    return (
      <p className="flex flex-wrap gap-x-2">
        <b className="w-16">{t(kind === 'temp_start' ? 'temp.start' : 'temp.end')}</b>
        {e?.temps ? (
          <span>
            <b className="tabular-nums">{e.temps.map((x) => fmtQty(x)).join(' / ')} ℃</b>
            <span className="text-xs text-muted">（{formatTokyoTime(new Date(e.created_at))} {e.author_name}）</span>
          </span>
        ) : (
          <span className="text-muted">{t('temp.noneYet')}</span>
        )}
      </p>
    )
  }
  return (
    <Card className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">🌡️ {t('temp.title')}</h2>
        <Button variant="secondary" className="min-h-10 py-1 text-sm" onClick={onEdit}>
          {t('temp.record')}
        </Button>
      </div>
      {row('temp_start')}
      {row('temp_end')}
    </Card>
  )
}

/** メニュー → 在庫・仕入 (日報 page 2) for one store × date × shift. */
export function StockPage() {
  const { t } = useTranslation('stock')
  const { isManager } = useAuth()
  const locale = currentLocale()
  const stores = useStores()
  const [params] = useSearchParams()
  const [preset] = useState(() => readSlotPreset(params))
  const [initial] = useState(() => (preset.date && preset.shift ? { businessDate: preset.date, shift: preset.shift } : currentSlot(new Date())))
  const [storeId, setStoreId] = useState(preset.storeCode ? '' : (getLastStore() ?? ''))
  const [date, setDate] = useState(initial.businessDate)
  const [shift, setShift] = useState<Shift>(initial.shift)
  const [mode, setMode] = useState<Mode | null>(null)
  const [editing, setEditing] = useState<StockEvent | null>(null)

  const store =
    stores.data?.find((s) => s.id === storeId) ?? stores.data?.find((s) => s.code === preset.storeCode) ?? stores.data?.[0]
  const items = useStockItems(store?.id ?? '')
  const events = useStockEvents(store?.id ?? '', date, shift)
  const prev = previousSlot(date, shift)
  const prevEvents = useStockEvents(store?.id ?? '', prev.businessDate, prev.shift)

  if (stores.isLoading || items.isLoading || events.isLoading || prevEvents.isLoading) return <Spinner />
  if (!store) return <ErrorBox message={t('common:error.generic')} />
  const error = items.error ?? events.error ?? prevEvents.error
  if (error) return <ErrorBox message={errorMessage(error)} />

  const slot: Slot = { store, date, shift }
  const states = stockState(items.data ?? [], events.data ?? [], prevEvents.data ?? [])
  const done = () => {
    setMode(null)
    setEditing(null)
    window.scrollTo({ top: 0 })
  }

  if (editing)
    return (
      <EntryForm
        kind={editing.kind as LineKind}
        slot={slot}
        states={stockState(items.data ?? [], (events.data ?? []).filter((e) => e.id !== editing.id), prevEvents.data ?? [])}
        replacing={editing}
        onDone={done}
      />
    )

  if (mode === 'temp') return <TempForm slot={slot} events={events.data ?? []} onDone={done} />
  if (mode === 'recount') return <EntryForm kind="open" slot={slot} states={states} initialReason="no_record" onDone={done} />
  if (mode) return <EntryForm kind={mode} slot={slot} states={states} onDone={done} />

  const unknownOpening = states.length > 0 && states.some((s) => s.opening === null)
  const closed = states.some((s) => s.left !== null)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={`📦 ${t('title')}`} />
      <Card className="flex flex-col gap-3">
        <Segmented
          label={t('common:field.store')}
          value={store.id}
          onChange={setStoreId}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, locale) }))}
        />
        <Segmented label={t('common:field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))} />
        <DateField label={t('common:field.date')} value={date} back={isManager ? 60 : 1} onChange={setDate} />
        <p className="text-sm text-muted">{t('previousSlot', { slot: `${formatShortDate(prev.businessDate)} ${t(`common:shift.${prev.shift}`)}` })}</p>
      </Card>

      <History
        events={events.data ?? []}
        items={items.data ?? []}
        onEdit={(e) => {
          setEditing(e)
          window.scrollTo({ top: 0 })
        }}
      />

      {unknownOpening && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300">
          <p className="text-sm font-bold text-amber-900">⚠️ {t('noPrevious')}</p>
          <Button onClick={() => setMode('recount')}>{t('action.open')}</Button>
        </div>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{closed ? t('stateClosed') : t('stateNow')}</h2>
        <StateTable states={states} />
        {!closed && <p className="text-xs text-muted">{t('suggestHint')}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-2.5">
        <Button onClick={() => setMode('in')}>{t('action.in')}</Button>
        <Button variant="secondary" onClick={() => setMode('out')}>
          {t('action.out')}
        </Button>
        <Button variant="danger" onClick={() => setMode('loss')}>
          {t('action.loss')}
        </Button>
        <Button onClick={() => setMode('close')}>{t('action.close')}</Button>
        {!unknownOpening && (
          <Button variant="ghost" className="self-center" onClick={() => setMode('open')}>
            ✎ {t('action.openMismatch')}
          </Button>
        )}
      </div>

      {(store.fridge_count ?? 0) > 0 && <TempSummary events={events.data ?? []} onEdit={() => setMode('temp')} />}
    </div>
  )
}
