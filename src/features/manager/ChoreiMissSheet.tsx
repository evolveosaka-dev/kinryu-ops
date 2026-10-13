import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, TextArea } from '../../components/ui'
import type { StatMiss } from '../../domain/stats'
import { MISS_ICON, MISS_REASONS, type MissReason, type Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import type { PreparedMedia } from '../../lib/media'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { Sheet } from './common'
import { jstDateTime } from './data'

/**
 * A 朝礼 slot without a record (管理 → 朝礼一覧): see the reported reason, set or change it (with photos /
 * videos), remove the report (back to ✗), or ✓ = open the 朝礼 form to record it afterwards at the meeting time.
 */
export function ChoreiMissSheet({
  slot,
  storeCode,
  title,
  reporterName,
  onClose,
}: {
  slot: { date: string; storeId: string; shift: Shift; miss?: StatMiss }
  storeCode: string
  title: string
  reporterName: (id: string) => string
  onClose: () => void
}) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const uploads = useUploadQueue()
  const m = slot.miss
  const [choice, setChoice] = useState<MissReason | null>(m?.kind === 'missed' ? m.reason : null)
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const files = (m?.attachments ?? []).filter((a) => a.status === 'pending' || a.status === 'uploaded')
  const taken = { images: files.filter((a) => a.kind === 'image').length, videos: files.filter((a) => a.kind === 'video').length }
  const [note, setNote] = useState(m?.note ?? '')
  const needNote = choice === 'other' && !note.trim()

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
    onClose()
  }
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        kind: 'missed',
        reason: choice,
        note: note.trim() || null,
        // a changed note no longer matches the reporter's 原文
        ...(m && (note.trim() || null) !== m.note ? { original_texts: null, source_lang: null } : {}),
      }
      const res = m
        ? await supabase.from('chorei_misses').update(row).eq('id', m.id).select('id').single()
        : await supabase.from('chorei_misses').insert({ ...row, store_id: slot.storeId, business_date: slot.date, shift: slot.shift }).select('id').single()
      const { id } = unwrap<{ id: string }>(res)
      // photos / videos go to Google Drive in the background (queued, retried)
      if (media.length) await uploads.enqueue('miss', id, media)
    },
    onSuccess: () => {
      toast(t('misses.saved'))
      done()
    },
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('chorei_misses').delete().eq('id', m!.id)),
    onSuccess: () => {
      toast(t('misses.removed'))
      done()
    },
  })
  const error = save.error ?? remove.error

  const tile = (value: MissReason, label: string, icon: string) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={choice === value}
      onClick={() => setChoice(value)}
      className={cx(
        'flex min-h-12 items-center gap-2 rounded-xl border-[1.5px] px-3 text-left font-bold',
        choice === value ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  )

  return (
    <Sheet title={title} onClose={onClose}>
      <Card className="flex flex-col gap-2">
        <h3 className="font-bold">{t('misses.now')}</h3>
        {!m && <p className="font-bold text-red-700">✗ {t('misses.unreported')}</p>}
        {m?.kind === 'done' && <p className="font-bold text-teal-800">✓ {t('misses.confirmed')}</p>}
        {m?.kind === 'missed' && m.reason && (
          <p className="font-bold text-amber-900">
            {MISS_ICON[m.reason]} {t(`chorei:miss.reason.${m.reason}`)}
          </p>
        )}
        {m?.note && (
          <p className="text-sm whitespace-pre-wrap">
            {m.note}
            {m.original_texts?.note && <span className="mt-1 block text-xs text-slate-600">{t('detail.original')}: {m.original_texts.note}</span>}
          </p>
        )}
        {files.length > 0 && (
          <p className="flex flex-wrap gap-2 text-sm">
            {files.map((a, i) => (
              <a key={a.id} href={a.drive_url ?? '#'} target="_blank" rel="noreferrer" className="font-bold text-brand underline">
                {a.kind === 'video' ? '🎥' : '📷'} {i + 1}
              </a>
            ))}
          </p>
        )}
        {m && (
          <p className="text-xs text-slate-600">
            {jstDateTime(m.updated_at)} ・ {reporterName(m.reporter_id)}
            {m.by_manager && `（${t('misses.byManager')}）`}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 ring-2 ring-teal-300">
        <h3 className="font-bold">✓ {t('misses.markDone')}</h3>
        <p className="text-sm text-slate-600">{t('misses.markDoneHint')}</p>
        <Button
          onClick={() => navigate(`/chorei?${new URLSearchParams({ store: storeCode, date: slot.date, shift: slot.shift, backfill: '1' }).toString()}`)}
        >
          {t('misses.openForm')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-2">
        <h3 className="font-bold">{t('misses.edit')}</h3>
        <div role="radiogroup" aria-label={t('misses.edit')} className="flex flex-col gap-2">
          {MISS_REASONS.map((r) => tile(r, t(`chorei:miss.reason.${r}`), MISS_ICON[r]))}
        </div>
        <TextArea
          label={choice === 'other' ? `${t('misses.note')} *` : t('misses.note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={needNote ? t('common:error.required') : null}
        />
        <AttachmentPicker value={media} onChange={setMedia} taken={taken} />
        {error && <ErrorBox message={errorMessage(error)} />}
        <Button onClick={() => save.mutate()} disabled={!choice || needNote || save.isPending || remove.isPending}>
          {t('misses.save')}
        </Button>
        {m && (
          <Button variant="secondary" onClick={() => remove.mutate()} disabled={save.isPending || remove.isPending}>
            {t('misses.remove')}
          </Button>
        )}
      </Card>
    </Sheet>
  )
}
