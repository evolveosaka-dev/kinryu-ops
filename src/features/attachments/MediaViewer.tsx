import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../components/Sheet'
import { ErrorBox, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary } from '../../lib/types'

// 朝礼の写真・動画 in the app (owner, 2026-10-20): the Drive files stay private; drive-view hands out links valid 2 h
// (staff: uploaded files of valid 朝礼 records; managers: any file).

async function signedUrls(ids: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.functions.invoke('drive-view', { body: { ids } })
  if (error) throw error
  return (data as { urls: Record<string, string> }).urls
}

export function MediaViewer({ list, title, onClose }: { list: AttachmentSummary[]; title: string; onClose: () => void }) {
  const { t } = useTranslation()
  const files = list.filter((a) => a.status === 'uploaded')
  const urls = useQuery({
    queryKey: ['drive-view', files.map((a) => a.id).join(',')],
    staleTime: 60 * 60 * 1000,
    queryFn: () => signedUrls(files.map((a) => a.id)),
  })
  // videos first: the 朝礼 itself is usually the video
  const ordered = [...files].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1))
  return (
    <Sheet title={title} onClose={onClose}>
      {urls.isLoading && <Spinner label={t('attach.viewLoading')} />}
      {urls.error && <ErrorBox message={t('attach.viewError')} />}
      {urls.data && (
        <div className="flex flex-col gap-3">
          {ordered.map((a, i) => {
            const src = urls.data[a.id]
            if (!src) return null
            return a.kind === 'video' ? (
              <video key={a.id} src={src} controls playsInline preload="metadata" className="w-full rounded-xl bg-black" aria-label={`${t('attach.video')} ${i + 1}`} />
            ) : (
              <img key={a.id} src={src} alt={`${t('attach.photo')} ${i + 1}`} loading="lazy" className="w-full rounded-xl border border-line" />
            )
          })}
          <p className="text-xs text-slate-600">{t('attach.viewNote')}</p>
        </div>
      )}
    </Sheet>
  )
}

/** 「▶ 写真・動画を見る」 button + the viewer. */
export function ViewMediaButton({ list, title }: { list: AttachmentSummary[]; title: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!list.some((a) => a.status === 'uploaded')) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-lg border border-brand bg-white px-3 text-sm font-bold text-brand">
        ▶ {t('attach.view')}
      </button>
      {open && <MediaViewer list={list} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}
