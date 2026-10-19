import { useTranslation } from 'react-i18next'
import type { AttachmentSummary } from '../../lib/types'
import { useUploadQueue } from '../attachments/uploadQueue'

/**
 * Photos / videos of a record for managers: counts, links to the uploaded files, files still uploading
 * or failed on the server, and files waiting in this device's upload queue.
 */
export function AttachmentList({ list, parentId }: { list: AttachmentSummary[]; parentId: string }) {
  const { t } = useTranslation('manager')
  const { items } = useUploadQueue()
  const live = list.filter((a) => a.status === 'uploaded' || a.status === 'pending')
  const uploaded = list.filter((a) => a.status === 'uploaded')
  const pending = list.filter((a) => a.status === 'pending')
  const failed = list.filter((a) => a.status === 'failed')
  // the sender gave these up (やめる) after they could not be sent
  const dropped = list.filter((a) => a.status === 'deleted' && !a.drive_url)
  // did not arrive: gone from the sender's phone, closed by a manager, or still waiting after 48 hours
  const lost = list.filter((a) => a.status === 'lost')
  // on this device: queued / uploading items not yet started on the server (no attachment row yet)
  const local = items.filter((i) => i.parentId === parentId && !list.some((a) => a.id === i.attachmentId))
  const count = (kind: 'image' | 'video') =>
    live.filter((a) => a.kind === kind).length + local.filter((i) => i.kind === kind && i.status !== 'error').length

  return (
    <span className="flex flex-col gap-1">
      <span className="font-bold">{t('files.count', { images: count('image'), videos: count('video') })}</span>
      {uploaded.length > 0 && (
        <span className="flex flex-wrap gap-2">
          {uploaded.map((a, i) => (
            <a key={a.id} href={a.drive_url ?? '#'} target="_blank" rel="noreferrer" className="font-bold text-brand underline">
              {a.kind === 'video' ? '🎥' : '📷'} {i + 1}
            </a>
          ))}
        </span>
      )}
      {pending.length > 0 && <span className="text-sm text-blue-800">⏳ {t('files.pending', { n: pending.length })}</span>}
      {local.map((i) => (
        <span key={i.id} className={i.status === 'error' ? 'text-sm text-red-800' : 'text-sm text-blue-800'}>
          {i.kind === 'video' ? '🎥' : '📷'} {i.fileName} —{' '}
          {i.status === 'error' ? `⚠️ ${t('files.localFailed')}（${i.error ?? ''}）` : i.status === 'uploading' ? t('files.uploading', { pct: Math.round(i.progress * 100) }) : t('files.waiting')}
        </span>
      ))}
      {failed.length > 0 && <span className="text-sm text-red-800">⚠️ {t('files.failed', { n: failed.length })}</span>}
      {lost.length > 0 && <span className="text-sm text-amber-800">📭 {t('files.lost', { n: lost.length })}</span>}
      {dropped.length > 0 && <span className="text-sm text-slate-600">🗑️ {t('files.dropped', { n: dropped.length })}</span>}
    </span>
  )
}
