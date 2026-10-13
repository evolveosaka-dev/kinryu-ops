import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSentNotice } from '../../components/SentNotice'
import { Button, Card, ErrorBox, TextArea } from '../../components/ui'
import { formatTokyoTime } from '../../domain/time'
import { MISS_ICON, MISS_REASONS, type MissReason, type Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import { errorMessage, isNetworkError } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { ChoreiMiss } from '../../lib/types'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'

/** 朝礼できなかった: the leader reports why there was no 朝礼 instead of leaving the slot empty. */
export function MissReport({
  storeId,
  businessDate,
  shift,
  slotLabel,
  miss,
}: {
  storeId: string
  businessDate: string
  shift: Shift
  slotLabel: string
  miss: ChoreiMiss | null
}) {
  const { t } = useTranslation('chorei')
  const navigate = useNavigate()
  const sent = useSentNotice()
  const queryClient = useQueryClient()
  const translation = useTranslationGate()
  const reported = miss?.kind === 'missed' ? miss : null
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<MissReason | null>(reported?.reason ?? null)
  const [note, setNote] = useState('')
  const [showMissing, setShowMissing] = useState(false)
  const needNote = reason === 'other' && !note.trim()

  const report = useMutation({
    mutationFn: async () => {
      if (!reason || needNote) {
        setShowMissing(true)
        throw new Error('validation')
      }
      const tr = await translation.prepare([{ key: 'note', label: t('miss.note'), text: note.trim() || null }])
      return unwrap(
        await supabase.rpc('report_chorei_miss', {
          p_store: storeId,
          p_date: businessDate,
          p_shift: shift,
          p_reason: reason,
          p_note: tr.values.note ?? null,
          p_original: tr.originals,
          p_lang: tr.sourceLang,
        }),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chorei_slot'] })
      sent({ kind: t('common:sent.miss'), detail: `${slotLabel}・${MISS_ICON[reason!]} ${t(`miss.reason.${reason}`)}` })
      void navigate('/')
    },
  })
  const err = report.error
  const errorText =
    !err || err.message === 'validation' || err instanceof TranslationCancelled
      ? null
      : /already reported/.test(err.message)
        ? t('miss.already')
        : /already recorded/.test(err.message)
          ? t('miss.recorded')
          : isNetworkError(err)
            ? t('common:error.network')
            : `${t('common:error.generic')} (${errorMessage(err)})`

  if (miss?.kind === 'done') return null

  return (
    <Card className={cx('flex flex-col gap-3', (open || reported) && 'ring-2 ring-amber-400')}>
      {translation.review}
      {reported && !open && (
        <div className="flex flex-col gap-1">
          <h2 className="font-bold text-amber-900">⚠️ {t('miss.reportedTitle')}</h2>
          <p className="text-sm">
            {MISS_ICON[reported.reason!]} <b>{t(`miss.reason.${reported.reason}`)}</b>
            {reported.note && `：${reported.note}`}
          </p>
          <p className="text-sm text-slate-600">{t('existing.by', { name: reported.reporter, time: formatTokyoTime(new Date(reported.at)) })}</p>
          <p className="text-sm">{t('miss.stillCanRecord')}</p>
        </div>
      )}
      {!open ? (
        (!reported || reported.mine) && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            😓 {reported ? t('miss.change') : t('miss.button')}
          </Button>
        )
      ) : (
        <>
          <h2 className="font-bold">😓 {t('miss.title')}</h2>
          <p className="text-sm text-slate-600">{t('miss.hint')}</p>
          <div role="radiogroup" aria-label={t('miss.reasonLabel')} className="flex flex-col gap-2">
            {MISS_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={cx(
                  'flex min-h-12 items-center gap-2 rounded-xl border-[1.5px] px-3 text-left font-bold',
                  reason === r ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
                )}
              >
                <span aria-hidden>{MISS_ICON[r]}</span>
                {t(`miss.reason.${r}`)}
              </button>
            ))}
          </div>
          {showMissing && !reason && <ErrorBox message={t('miss.needReason')} />}
          <TextArea
            label={reason === 'other' ? `${t('miss.note')} *` : t('miss.note')}
            placeholder={t('miss.notePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={showMissing && needNote ? t('common:error.required') : null}
          />
          {errorText && <ErrorBox message={errorText} />}
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={report.isPending}>
              {t('miss.cancel')}
            </Button>
            <Button onClick={() => report.mutate()} disabled={report.isPending}>
              {report.isPending ? t('common:action.loading') : t('miss.send')}
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
