import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented } from '../../components/ui'
import { fmtQty, IN_PLACES, OPEN_REASONS, OUT_PLACES, parseQty, parseTemp, round1, type ItemState } from '../../domain/stock'
import { checkItem, flagLevel, standardDiffs, tempsOk, type Flag, type PhotoRead, type ReadItem, type ReadMove } from '../../domain/stockPhoto'
import type { Shift } from '../../domain/types'
import { formatShortDate } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { setLastStore } from '../../lib/lastStore'
import { prepareMedia, type PreparedMedia } from '../../lib/media'
import type { Store } from '../../lib/types'
import { useUploadQueue } from '../attachments/uploadQueue'
import { itemName, readStockPhoto, reportStockStandards, saveStockSheet, type SheetMove } from './data'

interface Slot {
  store: Store
  date: string
  shift: Shift
}

// the draft as typed: numbers stay strings until saving
interface DraftMove {
  place: string
  text: string
  person: string
  qty: string
}
interface DraftItem {
  code: string
  carry: string
  ins: DraftMove[]
  outs: DraftMove[]
  used: string
  left: string
  standard: string | null
  unsure: ReadItem['unsure']
  note: string | null
  /** a red problem the person confirmed as written on the paper */
  ok: boolean
}

const str = (n: number | null) => (n === null ? '' : String(n))
const toDraft = (r: ReadItem): DraftItem => ({
  code: r.code,
  carry: str(r.carry),
  ins: r.ins.filter((m) => m.qty !== null).map((m) => ({ place: m.place, text: m.place_text, person: m.person ?? '', qty: str(m.qty) })),
  outs: r.outs.filter((m) => m.qty !== null).map((m) => ({ place: m.place, text: m.place_text, person: m.person ?? '', qty: str(m.qty) })),
  used: str(r.used),
  left: str(r.left),
  standard: r.standard_text,
  unsure: r.unsure,
  note: r.note,
  ok: false,
})
const num = (s: string) => {
  const n = parseQty(s)
  return typeof n === 'number' ? n : null
}
const toRead = (d: DraftItem): ReadItem => {
  const move = (m: DraftMove): ReadMove => ({ place: m.place, place_text: m.text, person: m.person || null, qty: num(m.qty) })
  return { code: d.code, present: true, standard_text: d.standard, carry: num(d.carry), ins: d.ins.map(move), outs: d.outs.map(move), used: num(d.used), left: num(d.left), unsure: d.unsure, note: d.note }
}

/** 📷 日報の写真から読み取る: photo → AI → draft with marks → fix → save every row at once. */
export function PhotoRead({ slot, states, existing, onDone }: { slot: Slot; states: ItemState[]; existing: number; onDone: () => void }) {
  const { t } = useTranslation('stock')
  const toast = useToast()
  const queryClient = useQueryClient()
  const uploads = useUploadQueue()
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<PreparedMedia | null>(null)
  const [read, setRead] = useState<PhotoRead | null>(null)
  const [draft, setDraft] = useState<DraftItem[]>([])
  const [temps, setTemps] = useState<{ start: string[]; end: string[] }>({ start: [], end: [] })
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const byCode = new Map(states.map((s) => [s.item.code, s]))
  const fridges = slot.store.fridge_count ?? 0

  const reading = useMutation({
    mutationFn: async (file: File) => {
      const media = await prepareMedia(file)
      setPhoto(media)
      return readStockPhoto(slot.store.id, media.blob)
    },
    onSuccess: (r) => {
      setRead(r)
      setDraft(r.items.filter((i) => i.present && byCode.has(i.code)).map(toDraft))
      const pad = (xs: (number | null)[]) => Array.from({ length: fridges }, (_, i) => str(xs[i] ?? null))
      setTemps({ start: pad(r.temps_start), end: pad(r.temps_end) })
    },
  })

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) reading.mutate(file)
  }

  // checks on what is typed now
  const rows = draft.map((d) => {
    const s = byCode.get(d.code)!
    const flags = checkItem(toRead(d), s.item, s.carried)
    return { d, s, flags, red: flags.some((f) => flagLevel(f) === 'red') }
  })
  const missing = states.filter((s) => !draft.some((d) => d.code === s.item.code))
  const carryDiff = rows.some(({ d, s }) => s.carried !== null && num(d.carry) !== null && num(d.carry) !== s.carried)
  const tempValues = (xs: string[]) => xs.map((x) => parseTemp(x) ?? null)
  const tempsStartOk = tempsOk(tempValues(temps.start), fridges)
  const tempsEndOk = tempsOk(tempValues(temps.end), fridges)

  const set = (code: string, patch: Partial<DraftItem>) => setDraft((xs) => xs.map((x) => (x.code === code ? { ...x, ...patch, ok: false } : x)))

  const save = useMutation({
    mutationFn: async () => {
      // every move of one place in one row; the same item twice is added up
      const group = (kind: 'ins' | 'outs'): SheetMove[] => {
        const by = new Map<string, { notes: Set<string>; lines: Map<string, number> }>()
        for (const { d, s } of rows)
          for (const m of d[kind]) {
            const qty = num(m.qty)
            if (!qty || qty <= 0) continue
            const g = by.get(m.place) ?? { notes: new Set<string>(), lines: new Map<string, number>() }
            if (m.place === 'other' && m.text) g.notes.add(m.text)
            if (m.person) g.notes.add(t('photo.personNote', { name: m.person }))
            g.lines.set(s.item.id, round1((g.lines.get(s.item.id) ?? 0) + qty))
            by.set(m.place, g)
          }
        return [...by].map(([place, g]) => ({
          place,
          note: [...g.notes].join('、') || null,
          lines: [...g.lines].map(([item, qty]) => ({ item, qty })),
        }))
      }
      const openLines = rows.flatMap(({ d, s }) => {
        const c = num(d.carry)
        return c !== null && c !== s.carried ? [{ item: s.item.id, qty: c }] : []
      })
      const closeId = await saveStockSheet({
        store: slot.store.id,
        date: slot.date,
        shift: slot.shift,
        open: openLines.length ? { lines: openLines, reason: carryDiff ? reason : 'no_record', note: t('photo.openNote') } : null,
        ins: group('ins'),
        outs: group('outs'),
        close: rows.flatMap(({ d, s }) => (num(d.left) === null ? [] : [{ item: s.item.id, qty: num(d.left)! }])),
        tempsStart: tempsStartOk ? (tempValues(temps.start) as number[]) : null,
        tempsEnd: tempsEndOk ? (tempValues(temps.end) as number[]) : null,
      })
      // the photo of the sheet goes to Drive with the 終わりの在庫 row (queued, retried)
      if (photo) await uploads.enqueue('stock', closeId, [photo])
      const diffs = read ? standardDiffs(read, states.map((s) => s.item)) : []
      if (diffs.length) await reportStockStandards(closeId, diffs.map((x) => ({ item: x.item.id, paper: x.paper, text: x.text }))).catch(() => undefined)
      return diffs.length
    },
    onSuccess: (diffs) => {
      setLastStore(slot.store.id)
      toast(diffs ? t('photo.savedStandards', { n: diffs }) : t('form.saved'))
      void queryClient.invalidateQueries({ queryKey: ['stock_events'] })
      onDone()
    },
  })

  const submit = () => {
    if (rows.some(({ d }) => [d.carry, d.used, d.left, ...d.ins.map((m) => m.qty), ...d.outs.map((m) => m.qty)].some((x) => parseQty(x) === undefined)))
      return setError(t('form.badNumber'))
    const open = rows.filter((r) => r.red && !r.d.ok)
    if (open.length) return setError(t('photo.confirmRed', { items: open.map((r) => itemName(t, r.s.item)).join('、') }))
    if (!rows.some(({ d }) => num(d.left) !== null)) return setError(t('photo.noLeft'))
    if (carryDiff && !reason) return setError(t('photo.reasonRequired'))
    if (rows.some(({ d }) => [...d.ins, ...d.outs].some((m) => m.place === 'other' && num(m.qty) && !m.text.trim()))) return setError(t('form.noteRequired'))
    setError(null)
    save.mutate()
  }

  const fileInputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={pick} />
    </>
  )

  if (!read)
    return (
      <div className="flex flex-col gap-3">
        <PageTitle title={`📷 ${t('photo.title')}`} subtitle={slotText(t, slot)} />
        <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{t('photo.help')}</p>
        {existing > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">⚠️ {t('photo.existing', { n: existing })}</p>}
        {fileInputs}
        {reading.isPending ? (
          <Card className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="size-8 animate-spin rounded-full border-4 border-brand border-t-transparent" aria-hidden />
            <p className="font-bold">{t('photo.reading')}</p>
            <p className="text-sm text-muted">{t('photo.readingHint')}</p>
          </Card>
        ) : (
          <>
            <Button onClick={() => camera.current?.click()}>📷 {t('photo.camera')}</Button>
            <Button variant="secondary" onClick={() => gallery.current?.click()}>
              🖼️ {t('photo.gallery')}
            </Button>
          </>
        )}
        {reading.error && <ErrorBox message={t('photo.readFailed', { error: errorMessage(reading.error) })} />}
        <Button variant="secondary" onClick={onDone} disabled={reading.isPending}>
          {t('form.cancel')}
        </Button>
      </div>
    )

  const red = rows.filter((r) => r.red).length
  const amber = rows.filter((r) => !r.red && r.flags.length).length
  const places = (kind: 'ins' | 'outs') => (kind === 'ins' ? IN_PLACES : OUT_PLACES).filter((p) => p !== slot.store.code)

  return (
    <div className="flex flex-col gap-3">
      <PageTitle title={`📷 ${t('photo.title')}`} subtitle={slotText(t, slot)} />
      <div className={cx('rounded-xl p-3 text-sm font-bold', red ? 'bg-red-50 text-red-900' : amber ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900')}>
        {red || amber ? t('photo.summary', { red, amber }) : t('photo.allOk')}
        <span className="mt-1 block font-normal">{t('photo.checkHelp')}</span>
      </div>
      {photo && <PhotoPreview blob={photo.blob} />}
      {existing > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">⚠️ {t('photo.existing', { n: existing })}</p>}

      {rows.map(({ d, s, flags, red }) => (
        <Card key={d.code} className={cx('flex flex-col gap-2', red ? 'ring-2 ring-red-400' : flags.length ? 'ring-2 ring-amber-300' : '')}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-bold">
              {red ? '🔴' : flags.length ? '🟡' : '✅'} {itemName(t, s.item)}
              <span className="ml-1 text-xs font-normal text-muted">{t(`unit.${s.item.unit}`)}</span>
            </h3>
            {s.carried !== null && <span className="text-xs text-muted">{t('photo.prevLeft', { n: fmtQty(s.carried) })}</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumBox label={t('photo.carry')} value={d.carry} bad={flags.some((f) => f.kind === 'carry_prev') || d.unsure.includes('carry')} onChange={(v) => set(d.code, { carry: v })} />
            <NumBox label={t('photo.used')} value={d.used} bad={d.unsure.includes('used')} onChange={(v) => set(d.code, { used: v })} />
            <NumBox label={t('photo.left')} value={d.left} bad={flags.some((f) => f.kind === 'sum' || f.kind === 'left_missing') || d.unsure.includes('left')} onChange={(v) => set(d.code, { left: v })} />
          </div>
          {(['ins', 'outs'] as const).map((kind) => (
            <div key={kind} className="flex flex-col gap-1.5">
              {d[kind].map((m, i) => (
                <div key={i} className="flex items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col text-xs font-bold text-slate-600">
                    {kind === 'ins' ? t('photo.inFrom') : t('photo.outTo')}
                    <select
                      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                      value={m.place}
                      onChange={(e) => set(d.code, { [kind]: d[kind].map((x, j) => (j === i ? { ...x, place: e.target.value } : x)) })}
                    >
                      {places(kind).map((p) => (
                        <option key={p} value={p}>
                          {t(`place.${p}`)}
                        </option>
                      ))}
                    </select>
                    {m.place === 'other' && <span className="font-normal text-amber-800">「{m.text}」</span>}
                    {m.person && <span className="font-normal">{t('photo.personNote', { name: m.person })}</span>}
                  </label>
                  <NumBox
                    label={kind === 'ins' ? t('table.in') : t('table.out')}
                    value={m.qty}
                    bad={d.unsure.includes(kind === 'ins' ? 'in' : 'out')}
                    onChange={(v) => set(d.code, { [kind]: d[kind].map((x, j) => (j === i ? { ...x, qty: v } : x)) })}
                  />
                  <button
                    type="button"
                    aria-label={t('photo.removeRow')}
                    className="min-h-11 shrink-0 px-2 text-lg text-slate-500"
                    onClick={() => set(d.code, { [kind]: d[kind].filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="self-start text-sm font-bold text-brand"
                onClick={() => set(d.code, { [kind]: [...d[kind], { place: places(kind)[0]!, text: '', person: '', qty: '' }] })}
              >
                ＋ {kind === 'ins' ? t('photo.addIn') : t('photo.addOut')}
              </button>
            </div>
          ))}
          {flags.map((f, i) => (
            <FlagLine key={i} flag={f} unit={t(`unit.${s.item.unit}`)} />
          ))}
          {red && (
            <label className="flex min-h-10 items-center gap-2 rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">
              <input type="checkbox" className="size-5 accent-brand" checked={d.ok} onChange={(e) => setDraft((xs) => xs.map((x) => (x.code === d.code ? { ...x, ok: e.target.checked } : x)))} />
              {t('photo.confirmOk')}
            </label>
          )}
        </Card>
      ))}

      {missing.length > 0 && (
        <p className="rounded-xl bg-slate-100 p-3 text-sm">
          <b>{t('photo.missingTitle')}</b>
          <span className="block">{missing.map((s) => itemName(t, s.item)).join('、')}</span>
          <span className="block text-muted">{t('photo.missingHelp')}</span>
        </p>
      )}

      {fridges > 0 && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">🌡️ {t('temp.title')}</h3>
          {(['start', 'end'] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">
                {t(`temp.${k}`)}
                {!(k === 'start' ? tempsStartOk : tempsEndOk) && <span className="ml-2 text-amber-800">{t('photo.tempsSkip')}</span>}
              </span>
              <div className="grid grid-cols-4 gap-2">
                {temps[k].map((v, i) => (
                  <input
                    key={i}
                    inputMode="decimal"
                    aria-label={t('temp.fridge', { n: i + 1 })}
                    value={v}
                    onChange={(e) => setTemps((x) => ({ ...x, [k]: x[k].map((y, j) => (j === i ? e.target.value : y)) }))}
                    className="min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 text-right font-bold"
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">{t('photo.tempsHint')}</p>
        </Card>
      )}

      {carryDiff && (
        <Card className="flex flex-col gap-2">
          <Segmented
            label={`${t('photo.reasonLabel')}（${t('form.required')}）`}
            value={reason}
            onChange={setReason}
            columns={1}
            options={OPEN_REASONS.filter((r) => r !== 'no_record').map((r) => ({ value: r, label: t(`reason.${r}`) }))}
          />
        </Card>
      )}

      {error && <ErrorBox message={error} />}
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      <Button onClick={submit} disabled={save.isPending}>
        {save.isPending ? t('common:action.loading') : t('photo.save')}
      </Button>
      {fileInputs}
      <Button variant="secondary" onClick={() => camera.current?.click()} disabled={save.isPending || reading.isPending}>
        📷 {t('photo.again')}
      </Button>
      <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
        {t('form.cancel')}
      </Button>
    </div>
  )
}

function slotText(t: (k: string) => string, slot: Slot) {
  return `${formatShortDate(slot.date)} ${t(`common:shift.${slot.shift}`)}・${storeName(slot.store, currentLocale())}`
}

function NumBox({ label, value, bad, onChange }: { label: string; value: string; bad?: boolean; onChange: (v: string) => void }) {
  const invalid = parseQty(value) === undefined
  return (
    <label className="flex w-24 shrink-0 flex-col text-xs font-bold text-slate-600">
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'min-h-11 w-full rounded-lg border px-2 text-right text-lg font-bold focus:border-brand focus:outline-none',
          invalid ? 'border-red-500 bg-white' : bad ? 'border-amber-500 bg-amber-50' : 'border-slate-400 bg-white',
        )}
      />
    </label>
  )
}

function FlagLine({ flag, unit }: { flag: Flag; unit: string }) {
  const { t } = useTranslation('stock')
  const red = flagLevel(flag) === 'red'
  const text = (() => {
    switch (flag.kind) {
      case 'sum':
        return t('photo.flag.sum', { n: fmtQty(flag.expected), unit })
      case 'carry_prev':
        return t('photo.flag.carryPrev', { n: fmtQty(flag.previous), unit })
      case 'unsure':
        return `${t('photo.flag.unsure', { fields: flag.fields.map((f) => t(`photo.field.${f}`)).join('・') })}${flag.note ? `（${flag.note}）` : ''}`
      case 'left_missing':
        return t('photo.flag.leftMissing')
      case 'negative':
        return t('photo.flag.negative')
      case 'unusual':
        return t('photo.flag.unusual', { n: fmtQty(flag.standard), unit })
      case 'place_other':
        return t('photo.flag.placeOther', { text: flag.text })
    }
  })()
  return <p className={cx('rounded-lg px-2 py-1 text-sm', red ? 'bg-red-50 font-bold text-red-800' : 'bg-amber-50 text-amber-900')}>{red ? '🔴' : '🟡'} {text}</p>
}

function PhotoPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation('stock')
  const [url] = useState(() => URL.createObjectURL(blob))
  return (
    <details className="rounded-xl bg-white ring-1 ring-line">
      <summary className="cursor-pointer p-3 text-sm font-bold">🖼️ {t('photo.showPhoto')}</summary>
      <img src={url} alt="" className="w-full rounded-b-xl" />
    </details>
  )
}

