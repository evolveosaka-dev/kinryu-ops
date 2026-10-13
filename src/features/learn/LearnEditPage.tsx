import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Segmented, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import {
  CATEGORY_ICON,
  LEARN_CATEGORIES,
  MAX_STEPS,
  youtubeId,
  type LearnCategory,
  type LearnItem,
  type LearnKind,
  type LearnText,
} from '../../domain/learn'
import { formatShortDate, formatTokyoTime, tokyoParts } from '../../domain/time'
import type { Locale } from '../../domain/types'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { prepareMedia, type PreparedMedia } from '../../lib/media'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { LEARN_BUCKET, translateLearnItem, useLearnItem, usePhotoUrls } from './data'

const TR_LANGS: Exclude<Locale, 'ja'>[] = ['en', 'vi', 'ne', 'si']

interface DraftStep {
  key: string
  text: string
  image: string | null
  file: PreparedMedia | null
  preview: string | null
}

const jaSignature = (title: string, summary: string, steps: string[], mistakes: string) => JSON.stringify([title.trim(), summary.trim(), steps.map((s) => s.trim()), mistakes.trim()])

/** 学ぶ: managers create / edit a manual or video page. Saving translates it into the 4 languages. */
export function LearnEditPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const item = useLearnItem(isNew ? undefined : id)
  if (!isNew && item.isLoading) return <Spinner />
  if (!isNew && item.error) return <ErrorBox message={errorMessage(item.error)} />
  return <Editor key={item.data?.id ?? 'new'} item={isNew ? null : (item.data ?? null)} />
}

function Editor({ item }: { item: LearnItem | null }) {
  const { t } = useTranslation('manager')
  const { t: tl } = useTranslation('learn')
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [id] = useState(() => item?.id ?? crypto.randomUUID())
  const [kind, setKind] = useState<LearnKind>(item?.kind ?? (params.get('kind') === 'video' ? 'video' : 'manual'))
  const [category, setCategory] = useState<LearnCategory>(item?.category ?? 'service')
  const [title, setTitle] = useState(item?.title ?? '')
  const [summary, setSummary] = useState(item?.summary ?? '')
  const [videoUrl, setVideoUrl] = useState(item?.video_url ?? '')
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    (item?.steps ?? []).map((s) => ({ key: crypto.randomUUID(), text: s.text, image: s.image, file: null, preview: null })),
  )
  const [mistakes, setMistakes] = useState(item?.mistakes ?? '')
  const [recommended, setRecommended] = useState(item?.recommended ?? false)
  const [published, setPublished] = useState(item?.published ?? false)
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0))
  const [showErrors, setShowErrors] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'translating'>('idle')
  const photos = usePhotoUrls(steps.flatMap((s) => (s.image ? [s.image] : [])))
  const fileInput = useRef<HTMLInputElement>(null)
  const [photoFor, setPhotoFor] = useState<string | null>(null)

  // free the local previews
  const previews = useRef(new Set<string>())
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const yt = youtubeId(videoUrl)
  const errors = {
    title: !title.trim() ? t('common:error.required') : null,
    video: videoUrl.trim() && !yt ? t('learn.badVideoUrl') : kind === 'video' && !yt ? t('common:error.required') : null,
    steps: steps.some((s) => !s.text.trim()) ? t('learn.stepEmpty') : null,
  }
  const valid = !errors.title && !errors.video && !errors.steps

  const patchStep = (key: string, patch: Partial<DraftStep>) => setSteps((xs) => xs.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const move = (i: number, d: number) =>
    setSteps((xs) => {
      const j = i + d
      if (j < 0 || j >= xs.length) return xs
      const copy = [...xs]
      ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
      return copy
    })

  const pickPhoto = (key: string) => {
    setPhotoFor(key)
    fileInput.current?.click()
  }
  const onFile = async (file: File | undefined) => {
    if (!file || !photoFor) return
    try {
      const media = await prepareMedia(file)
      if (media.kind !== 'image') throw new Error(t('learn.photoOnly'))
      const preview = URL.createObjectURL(media.blob)
      previews.current.add(preview)
      patchStep(photoFor, { file: media, preview, image: null })
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      setShowErrors(true)
      if (!valid) throw new Error('validation')
      setPhase('saving')
      // 1. new photos → Storage
      const finalSteps = await Promise.all(
        steps.map(async (s) => {
          if (!s.file) return { text: s.text.trim(), image: s.image }
          const path = `${id}/${crypto.randomUUID()}.jpg`
          const { error } = await supabase.storage.from(LEARN_BUCKET).upload(path, s.file.blob, { contentType: s.file.mimeType })
          if (error) throw error
          return { text: s.text.trim(), image: path }
        }),
      )
      const row = {
        kind,
        category,
        title: title.trim(),
        summary: summary.trim() || null,
        steps: finalSteps,
        mistakes: mistakes.trim() || null,
        video_url: videoUrl.trim() || null,
        recommended,
        published,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
      }
      // 2. the page
      if (item) unwrap(await supabase.from('learn_items').update(row).eq('id', id))
      else unwrap(await supabase.from('learn_items').insert({ id, ...row }))
      // 3. photos no longer used
      const kept = new Set(finalSteps.flatMap((s) => (s.image ? [s.image] : [])))
      const removed = (item?.steps ?? []).flatMap((s) => (s.image && !kept.has(s.image) ? [s.image] : []))
      if (removed.length) await supabase.storage.from(LEARN_BUCKET).remove(removed)
      // 4. translate when the Japanese changed (or was never translated)
      const changed =
        !item ||
        !item.translated_at ||
        jaSignature(item.title, item.summary ?? '', item.steps.map((s) => s.text), item.mistakes ?? '') !==
          jaSignature(row.title, row.summary ?? '', finalSteps.map((s) => s.text), row.mistakes ?? '')
      if (!changed) return null
      setPhase('translating')
      try {
        await translateLearnItem(id)
        return null
      } catch (err) {
        return errorMessage(err)
      }
    },
    onSuccess: (translateError) => {
      void queryClient.invalidateQueries({ queryKey: ['learn_items'] })
      toast(translateError ? t('learn.translateFailed', { msg: translateError }) : t('learn.saved'))
      void navigate(`/learn/${id}`, { replace: true })
    },
    onSettled: () => setPhase('idle'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const paths = (item?.steps ?? []).flatMap((s) => (s.image ? [s.image] : []))
      if (paths.length) await supabase.storage.from(LEARN_BUCKET).remove(paths)
      unwrap(await supabase.from('learn_items').delete().eq('id', id))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learn_items'] })
      toast(t('learn.deleted'))
      void navigate(kind === 'video' ? '/learn/videos' : '/learn/manual', { replace: true })
    },
  })

  const busy = phase !== 'idle' || remove.isPending
  const error = save.error && save.error.message !== 'validation' ? save.error : remove.error
  const selectClass = 'min-h-12 w-full rounded-xl border-[1.5px] border-line bg-white px-3 text-base'

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <Link to={item ? `/learn/${item.id}` : kind === 'video' ? '/learn/videos' : '/learn/manual'} className="flex min-h-11 items-center font-bold text-brand">
          ‹ {tl('back')}
        </Link>
      </div>
      <h1 className="text-[23px] leading-tight font-bold">{item ? t('learn.editTitle') : t('learn.newTitle')}</h1>

      <Card className="flex flex-col gap-4">
        <Segmented
          label={t('learn.kind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'manual', label: `📘 ${tl('manual.title')}` },
            { value: 'video', label: `🎥 ${tl('video.title')}` },
          ]}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-bold">{t('learn.category')}</span>
          <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as LearnCategory)}>
            {LEARN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_ICON[c]} {tl(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <TextInput label={`${t('learn.titleLabel')} *`} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} error={showErrors ? errors.title : null} />
        <TextInput
          label={kind === 'video' ? `${t('learn.videoUrl')} *` : t('learn.videoUrlOptional')}
          hint={t('learn.videoUrlHint')}
          inputMode="url"
          placeholder="https://youtu.be/…"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          error={showErrors || (videoUrl.trim() && !yt) ? errors.video : null}
        />
        {yt && <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" className="aspect-video w-48 rounded-lg object-cover" />}
        <TextArea label={t('learn.summary')} rows={3} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-bold">{tl('steps')}</h2>
        <p className="text-sm text-muted">{t('learn.stepsHint')}</p>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        {steps.map((s, i) => {
          const src = s.preview ?? (s.image ? photos.data?.get(s.image) : undefined)
          return (
            <div key={s.key} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{t('learn.stepLabel', { n: i + 1 })}</span>
                <span className="flex gap-1">
                  <button type="button" className="min-h-10 min-w-10 rounded-lg border border-line bg-white disabled:opacity-30" aria-label={t('learn.up')} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="min-h-10 min-w-10 rounded-lg border border-line bg-white disabled:opacity-30" aria-label={t('learn.down')} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="min-h-10 min-w-10 rounded-lg border border-red-300 bg-white text-red-700" aria-label={t('learn.removeStep')} onClick={() => setSteps((xs) => xs.filter((x) => x.key !== s.key))}>
                    ✕
                  </button>
                </span>
              </div>
              <TextArea
                label={<span className="sr-only">{t('learn.stepLabel', { n: i + 1 })}</span>}
                rows={2}
                maxLength={500}
                value={s.text}
                onChange={(e) => patchStep(s.key, { text: e.target.value })}
                error={showErrors && !s.text.trim() ? t('common:error.required') : null}
              />
              {(s.image || s.file) && (src ? <img src={src} alt="" className="max-h-60 w-full rounded-lg bg-white object-contain" /> : <div className="h-40 animate-pulse rounded-lg bg-slate-200" />)}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="px-3" onClick={() => pickPhoto(s.key)}>
                  📷 {s.image || s.file ? t('learn.changePhoto') : t('learn.addPhoto')}
                </Button>
                {(s.image || s.file) && (
                  <Button variant="ghost" className="px-3" onClick={() => patchStep(s.key, { image: null, file: null, preview: null })}>
                    {t('learn.removePhoto')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
        <p className="text-sm text-muted">⚠️ {t('learn.photoHint')}</p>
        <Button
          variant="secondary"
          disabled={steps.length >= MAX_STEPS}
          onClick={() => setSteps((xs) => [...xs, { key: crypto.randomUUID(), text: '', image: null, file: null, preview: null }])}
        >
          ＋ {t('learn.addStep')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-4">
        <TextArea label={t('learn.mistakes')} hint={t('learn.mistakesHint')} rows={4} maxLength={2000} value={mistakes} onChange={(e) => setMistakes(e.target.value)} />
        <TextInput label={t('learn.sortOrder')} hint={t('learn.sortOrderHint')} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^\d-]/g, ''))} />
        <Checkbox checked={recommended} onChange={setRecommended}>
          ⭐ {t('learn.recommended')}
        </Checkbox>
        <Checkbox checked={published} onChange={setPublished}>
          {t('learn.published')}
        </Checkbox>
      </Card>

      {item && <TranslationCard item={item} />}

      {item && (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('learn.deleteConfirm'))) remove.mutate()
          }}
        >
          🗑 {t('learn.delete')}
        </Button>
      )}

      {error && <ErrorBox message={errorMessage(error)} />}
      {showErrors && !valid && <ErrorBox message={t('learn.fixErrors')} />}

      <StickyActions>
        <Button className="w-full" onClick={() => save.mutate()} disabled={busy}>
          {phase === 'saving' ? t('learn.saving') : phase === 'translating' ? t('learn.translating') : t('learn.save')}
        </Button>
      </StickyActions>
    </div>
  )
}

/** Translation status, 翻訳する again, and fixing one language by hand. */
function TranslationCard({ item }: { item: LearnItem }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const fresh = Boolean(item.translated_at && Date.parse(item.translated_at) >= Date.parse(item.content_updated_at))
  const [lang, setLang] = useState<Exclude<Locale, 'ja'> | null>(null)
  const done = () => void queryClient.invalidateQueries({ queryKey: ['learn_items'] })

  const again = useMutation({
    mutationFn: () => translateLearnItem(item.id),
    onSuccess: () => {
      toast(t('learn.translated'))
      done()
    },
  })

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">🌐 {t('learn.translation')}</h2>
      <p className={cx('text-sm', fresh ? 'text-teal-800' : 'font-bold text-amber-800')}>
        {item.translated_at
          ? fresh
            ? t('learn.translatedAt', { date: `${formatShortDate(tokyoParts(new Date(item.translated_at)).date)} ${formatTokyoTime(new Date(item.translated_at))}` })
            : t('learn.translationOld')
          : t('learn.notYet')}
      </p>
      {again.error && <ErrorBox message={errorMessage(again.error)} />}
      <Button variant="secondary" disabled={again.isPending} onClick={() => again.mutate()}>
        {again.isPending ? t('learn.translating') : t('learn.retranslate')}
      </Button>
      {fresh && (
        <>
          <p className="text-sm text-muted">{t('learn.fixHint')}</p>
          <div className="grid grid-cols-4 gap-2">
            {TR_LANGS.map((l) => (
              <button key={l} type="button" onClick={() => setLang(lang === l ? null : l)} className={cx('min-h-11 rounded-xl border-[1.5px] text-sm font-bold', lang === l ? 'border-brand bg-brand text-white' : 'border-line bg-white')}>
                {tc(`lang.${l}`)}
              </button>
            ))}
          </div>
          {lang && item.translations[lang] && <LangEditor key={lang} item={item} lang={lang} onSaved={done} />}
        </>
      )}
    </Card>
  )
}

function LangEditor({ item, lang, onSaved }: { item: LearnItem; lang: Exclude<Locale, 'ja'>; onSaved: () => void }) {
  const { t } = useTranslation('manager')
  const { t: tl } = useTranslation('learn')
  const toast = useToast()
  const [text, setText] = useState<LearnText>(() => {
    const tr = item.translations[lang]!
    return { ...tr, steps: item.steps.map((s, i) => tr.steps[i] ?? s.text) }
  })
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from('learn_items')
          .update({ translations: { ...item.translations, [lang]: text }, translated_at: new Date().toISOString() })
          .eq('id', item.id),
      ),
    onSuccess: () => {
      toast(t('learn.saved'))
      onSaved()
    },
  })
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <TextInput label={`${t('learn.titleLabel')}（${item.title}）`} value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} />
      <TextArea label={t('learn.summary')} rows={3} value={text.summary} onChange={(e) => setText({ ...text, summary: e.target.value })} />
      {item.steps.map((s, i) => (
        <TextArea
          key={i}
          label={`${t('learn.stepLabel', { n: i + 1 })}（${s.text}）`}
          rows={2}
          value={text.steps[i] ?? ''}
          onChange={(e) => setText({ ...text, steps: text.steps.map((x, j) => (j === i ? e.target.value : x)) })}
        />
      ))}
      <TextArea label={tl('mistakes')} rows={3} value={text.mistakes} onChange={(e) => setText({ ...text, mistakes: e.target.value })} />
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {t('learn.saveLang')}
      </Button>
    </div>
  )
}
