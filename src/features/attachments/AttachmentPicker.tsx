import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Checkbox, ErrorBox } from '../../components/ui'
import { canAdd, MAX_IMAGES, MAX_VIDEOS, MediaError, prepareMedia, type MediaKind, type PreparedMedia } from '../../lib/media'
import { VideoSizeGuide } from './VideoSizeGuide'

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
  taken = { images: 0, videos: 0 },
  rule,
  requireAny = false,
  skip = false,
  onSkip,
}: {
  value: PreparedMedia[]
  onChange: (v: PreparedMedia[]) => void
  /** at least one photo is required (巡回) */
  requirePhoto?: boolean
  /** at least one photo or video is required (朝礼) */
  requireAny?: boolean
  /** 「接客中のため、写真・動画の撮影を控えました」: shown when onSkip is given; ticked = nothing required */
  skip?: boolean
  onSkip?: (v: boolean) => void
  /** two photo buttons: 撮影 (opens the camera) and 写真を選ぶ (from the phone) */
  camera?: boolean
  hint?: string
  /** when set, adding is disabled and this text explains why */
  lockedNote?: string | null
  /** show the "photo required" error */
  missing?: boolean
  /** files the record already has (a manager adding files later); they count toward the limits */
  taken?: { images: number; videos: number }
  /** replaces the 「お客様の顔は撮らない」 rule (a customer who agreed to be photographed) */
  rule?: string
}) {
  const { t } = useTranslation()
  const photoInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guide, setGuide] = useState(false)

  const add = async (files: FileList | null, kind: MediaKind) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    let next = [...value]
    const already = [...Array<{ kind: MediaKind }>(taken.images).fill({ kind: 'image' }), ...Array<{ kind: MediaKind }>(taken.videos).fill({ kind: 'video' })]
    for (const file of Array.from(files)) {
      if (!canAdd([...already, ...next], kind)) {
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

  const images = taken.images + value.filter((m) => m.kind === 'image').length
  const videos = taken.videos + value.filter((m) => m.kind === 'video').length

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-slate-700">
        {t('attach.title')}
        {requirePhoto && ' *'}
      </h2>
      {hint && <p className="text-sm">{hint}</p>}
      <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">⚠️ {rule ?? t('attach.rule')}</p>
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
          className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold disabled:text-slate-500"
        >
          📷 {camera ? t('attach.takePhoto') : t('attach.addPhoto')}（{images}/{MAX_IMAGES}）
        </button>
        {camera && (
          <button
            type="button"
            disabled={busy || images >= MAX_IMAGES || Boolean(lockedNote)}
            onClick={() => galleryInput.current?.click()}
            className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold disabled:text-slate-500"
          >
            🖼️ {t('attach.choosePhoto')}
          </button>
        )}
        <button
          type="button"
          disabled={busy || videos >= MAX_VIDEOS || Boolean(lockedNote)}
          onClick={() => videoInput.current?.click()}
          className={`min-h-12 rounded-xl border border-slate-300 bg-white font-bold disabled:text-slate-500 ${camera ? 'col-span-2' : ''}`}
        >
          🎥 {t('attach.addVideo')}（{videos}/{MAX_VIDEOS}）
        </button>
      </div>
      {lockedNote && <p className="text-sm text-slate-600">{lockedNote}</p>}
      <input ref={photoInput} type="file" accept="image/*" multiple={!camera} capture={camera ? 'environment' : undefined} hidden onChange={(e) => void add(e.target.files, 'image').then(() => (e.target.value = ''))} />
      <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files, 'image').then(() => (e.target.value = ''))} />
      <input ref={videoInput} type="file" accept="video/*" multiple hidden onChange={(e) => void add(e.target.files, 'video').then(() => (e.target.value = ''))} />
      {busy && <p className="text-sm text-slate-600">{t('attach.processing')}</p>}
      <p className="text-xs text-slate-600">{t('attach.limit')}</p>
      {(videos > taken.videos || error === t('attach.tooLarge')) && (
        <button type="button" onClick={() => setGuide((g) => !g)} aria-expanded={guide} className="min-h-10 self-start text-sm font-bold text-blue-800 underline">
          🎥 {t('upload.videoGuide')} {guide ? '▲' : '▼'}
        </button>
      )}
      {guide && <VideoSizeGuide />}
      {error && <ErrorBox message={error} />}
      {onSkip && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-2 py-1">
          <Checkbox checked={skip} onChange={onSkip}>
            <b>📵 {t('attach.skip')}</b>
          </Checkbox>
          <p className="pb-1 text-xs text-amber-900">{t('attach.skipNote')}</p>
        </div>
      )}
      {missing && !skip && requirePhoto && images === 0 && <ErrorBox message={t(onSkip ? 'attach.photoOrSkip' : 'attach.photoRequired')} />}
      {missing && !skip && requireAny && value.length + taken.images + taken.videos === 0 && <ErrorBox message={t('attach.mediaOrSkip')} />}
    </Card>
  )
}
