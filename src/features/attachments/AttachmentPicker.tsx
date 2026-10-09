import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, ErrorBox } from '../../components/ui'
import { canAdd, MAX_IMAGES, MediaError, prepareMedia, type MediaKind, type PreparedMedia } from '../../lib/media'

function Thumb({ media, onRemove }: { media: PreparedMedia; onRemove: () => void }) {
  const { t } = useTranslation()
  const [url] = useState(() => (media.kind === 'image' ? URL.createObjectURL(media.blob) : null))
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return (
    <li className="relative size-24 overflow-hidden rounded-xl bg-slate-200">
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center text-sm font-bold text-slate-700">
          <span aria-hidden className="text-2xl">
            🎥
          </span>
          {media.durationSec}s
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('attach.remove')}
        className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-black/70 text-white"
      >
        ✕
      </button>
    </li>
  )
}

/** Choose photos/videos for a record. Files are uploaded after the record is sent. */
export function AttachmentPicker({
  value,
  onChange,
  requirePhoto = false,
  camera = false,
  hint,
  lockedNote,
  missing = false,
}: {
  value: PreparedMedia[]
  onChange: (v: PreparedMedia[]) => void
  /** at least one photo is required (巡回) */
  requirePhoto?: boolean
  /** open the camera directly instead of the gallery */
  camera?: boolean
  hint?: string
  /** when set, adding is disabled and this text explains why */
  lockedNote?: string | null
  /** show the "photo required" error */
  missing?: boolean
}) {
  const { t } = useTranslation()
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (files: FileList | null, kind: MediaKind) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    let next = [...value]
    for (const file of Array.from(files)) {
      if (!canAdd(next, kind)) {
        setError(t('attach.tooMany'))
        break
      }
      try {
        next = [...next, await prepareMedia(file)]
      } catch (err) {
        setError(t(`attach.${err instanceof MediaError ? err.code : 'unsupported'}`))
      }
    }
    onChange(next)
    setBusy(false)
  }

  const images = value.filter((m) => m.kind === 'image').length
  const videos = value.length - images

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-slate-700">
        {t('attach.title')}
        {requirePhoto && ' *'}
      </h2>
      {hint && <p className="text-sm">{hint}</p>}
      <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">⚠️ {t('attach.rule')}</p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((m) => (
            <Thumb key={m.id} media={m} onRemove={() => onChange(value.filter((x) => x.id !== m.id))} />
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || images >= MAX_IMAGES || Boolean(lockedNote)}
          onClick={() => photoInput.current?.click()}
          className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold disabled:text-slate-400"
        >
          📷 {t('attach.addPhoto')}（{images}/{MAX_IMAGES}）
        </button>
        <button
          type="button"
          disabled={busy || videos >= 1 || Boolean(lockedNote)}
          onClick={() => videoInput.current?.click()}
          className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold disabled:text-slate-400"
        >
          🎥 {t('attach.addVideo')}（{videos}/1）
        </button>
      </div>
      {lockedNote && <p className="text-sm text-slate-600">{lockedNote}</p>}
      <input ref={photoInput} type="file" accept="image/*" multiple={!camera} capture={camera ? 'environment' : undefined} hidden onChange={(e) => void add(e.target.files, 'image').then(() => (e.target.value = ''))} />
      <input ref={videoInput} type="file" accept="video/*" hidden onChange={(e) => void add(e.target.files, 'video').then(() => (e.target.value = ''))} />
      {busy && <p className="text-sm text-slate-600">{t('attach.processing')}</p>}
      <p className="text-xs text-slate-500">{t('attach.limit')}</p>
      {error && <ErrorBox message={error} />}
      {missing && requirePhoto && images === 0 && <ErrorBox message={t('attach.photoRequired')} />}
    </Card>
  )
}
