import { useTranslation } from 'react-i18next'
import { useUploadQueue } from './uploadQueue'

/** Banner under the header while photos/videos are waiting or uploading. */
export function UploadStatus() {
  const { t } = useTranslation()
  const { items, retry, discard } = useUploadQueue()
  if (items.length === 0) return null

  const failed = items.filter((i) => i.status === 'error')
  const active = items.filter((i) => i.status !== 'error')
  const totalBytes = active.reduce((s, i) => s + i.size, 0)
  const doneBytes = active.reduce((s, i) => s + i.size * i.progress, 0)
  const pct = totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0
  const uploading = active.some((i) => i.status === 'uploading')

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 bg-blue-50 px-4 py-2 text-sm" role="status">
      {active.length > 0 && (
        <div>
          <p className="font-bold text-blue-900">
            📤 {uploading ? t('upload.uploading', { n: active.length, pct }) : t('upload.waiting', { n: active.length })}
          </p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-bold text-red-800">⚠️ {t('upload.failed', { n: failed.length })}</p>
          <ul className="text-xs text-red-800">
            {failed.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {f.fileName} — {f.error}
                </span>
                <button type="button" className="min-h-9 shrink-0 underline" onClick={() => void discard(f.id)}>
                  {t('upload.discard')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={retry} className="min-h-10 self-start rounded-lg bg-white px-3 font-bold ring-1 ring-red-300">
            {t('upload.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
