import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox } from '../../components/ui'
import { signedDiff, yen } from '../../domain/sales'
import type { SalesFlag, SalesPhotoRead } from '../../domain/salesPhoto'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { prepareMedia, type PreparedMedia } from '../../lib/media'
import { readSalesPhoto } from './data'

export interface SalesPhoto {
  read: SalesPhotoRead
  media: PreparedMedia
  flags: SalesFlag[]
}

/** 📷 日報の写真から読み取る: take / choose the photo of the paper 日報 (1ページ表), the AI reads it. Nothing is saved. */
export function SalesPhotoPick({ storeId, onRead, onCancel }: { storeId: string; onRead: (read: SalesPhotoRead, media: PreparedMedia) => void; onCancel: () => void }) {
  const { t } = useTranslation('sales')
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const reading = useMutation({
    mutationFn: async (file: File) => {
      const media = await prepareMedia(file)
      return { media, read: await readSalesPhoto(storeId, media.blob) }
    },
    onSuccess: ({ read, media }) => onRead(read, media),
  })
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) reading.mutate(file)
  }
  return (
    <Card className="flex flex-col gap-3 ring-2 ring-brand">
      <h2 className="text-[17px] font-bold">📷 {t('photo.title')}</h2>
      <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{t('photo.help')}</p>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={pick} />
      {reading.isPending ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="size-8 animate-spin rounded-full border-4 border-brand border-t-transparent" aria-hidden />
          <p className="font-bold">{t('photo.reading')}</p>
          <p className="text-sm text-muted">{t('photo.readingHint')}</p>
        </div>
      ) : (
        <>
          <Button onClick={() => camera.current?.click()}>📷 {t('photo.camera')}</Button>
          <Button variant="secondary" onClick={() => gallery.current?.click()}>
            🖼️ {t('photo.gallery')}
          </Button>
        </>
      )}
      {reading.error && <ErrorBox message={t('photo.readFailed', { error: errorMessage(reading.error) })} />}
      <Button variant="secondary" onClick={onCancel} disabled={reading.isPending}>
        {t('photo.cancel')}
      </Button>
    </Card>
  )
}

function PhotoPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation('sales')
  const [url] = useState(() => URL.createObjectURL(blob))
  return (
    <details className="rounded-xl bg-white ring-1 ring-line">
      <summary className="cursor-pointer p-3 text-sm font-bold">🖼️ {t('photo.showPhoto')}</summary>
      <img src={url} alt="" className="w-full rounded-b-xl" />
    </details>
  )
}

/** What the person must look at after reading: the paper's own results vs the app's, marks, the AI's notes. */
export function SalesPhotoCheck({
  photo,
  live,
  onClear,
}: {
  photo: SalesPhoto
  /** values the form computes now (they change while the person corrects) */
  live: { ticketTotal: number; noodleDiff: number | null; cashExpected: number | null; cashDiff: number | null; cashActual: number | null }
  onClear: () => void
}) {
  const { t } = useTranslation('sales')
  const { read, flags } = photo
  const slotFlag = flags.find((f) => f.kind === 'slot')
  const lines: { red: boolean; text: string }[] = []
  if (slotFlag?.kind === 'slot')
    lines.push({
      red: true,
      text: t('photo.flag.slot', {
        what: [slotFlag.store && t(`photo.store.${slotFlag.store}`), slotFlag.date && formatShortDate(slotFlag.date), slotFlag.shift && t(`common:shift.${slotFlag.shift}`)].filter(Boolean).join(' '),
      }),
    })
  // the paper's own results vs what the app computes from the figures
  const cmp = (label: string, paper: number | null, app: number | null, fmt: (n: number | null) => string) => {
    if (paper !== null && app !== null && paper !== app) lines.push({ red: true, text: t('photo.flag.compare', { label, paper: fmt(paper), app: fmt(app) }) })
  }
  cmp(t('tickets.total'), read.tickets.total, live.ticketTotal, (n) => `${n ?? '—'}${t('unit.sheets')}`)
  cmp(t('confirm.noodle'), read.noodle_diff, live.noodleDiff, (n) => signedDiff(n, t('unit.pieces')))
  cmp(t('cash.expected'), read.cash_expected, live.cashExpected, yen)
  cmp(t('cash.actual'), read.cash_actual_total, live.cashActual, yen)
  cmp(t('cash.diff'), read.cash_diff, live.cashDiff, (n) => signedDiff(n, '円'))
  for (const f of flags) {
    if (f.kind === 'slot' || f.kind === 'ticketTotal' || f.kind === 'countsTotal') continue
    if (f.kind === 'carried') lines.push({ red: true, text: t('photo.flag.carried', { paper: yen(f.paper), app: yen(f.app) }) })
    if (f.kind === 'countsMissing') lines.push({ red: true, text: t('photo.flag.countsMissing', { total: yen(f.total) }) })
    if (f.kind === 'staffTime') lines.push({ red: false, text: t('photo.flag.staffTime', f) })
    if (f.kind === 'staffNotOnPaper') lines.push({ red: false, text: t('photo.flag.staffNotOnPaper', f) })
    if (f.kind === 'staffUnknown') lines.push({ red: false, text: t('photo.flag.staffUnknown', f) })
    if (f.kind === 'otherOut') lines.push({ red: false, text: t('photo.flag.otherOut', f) })
    if (f.kind === 'waterHour') lines.push({ red: false, text: t('photo.flag.waterHour', f) })
  }
  if (read.unsure.length) lines.push({ red: false, text: t('photo.flag.unsure', { n: read.unsure.length }) })
  const red = lines.some((l) => l.red)
  return (
    <Card className={cx('flex flex-col gap-2 ring-2', red ? 'ring-red-400' : lines.length ? 'ring-amber-300' : 'ring-green-400')}>
      <h2 className="font-bold">📷 {t('photo.readTitle')}</h2>
      <p className={cx('rounded-lg p-2 text-sm font-bold', red ? 'bg-red-50 text-red-900' : lines.length ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900')}>
        {lines.length ? t('photo.checkHelp') : t('photo.allOk')}
      </p>
      {lines.map((l, i) => (
        <p key={i} className={cx('rounded-lg px-2 py-1 text-sm', l.red ? 'bg-red-50 font-bold text-red-800' : 'bg-amber-50 text-amber-900')}>
          {l.red ? '🔴' : '🟡'} {l.text}
        </p>
      ))}
      {read.note && <p className="rounded-lg bg-slate-100 px-2 py-1 text-sm">🤖 {read.note}</p>}
      <PhotoPreview blob={photo.media.blob} />
      <p className="text-xs text-muted">{t('photo.savedWith')}</p>
      <Button variant="secondary" onClick={onClear}>
        {t('photo.discard')}
      </Button>
    </Card>
  )
}
