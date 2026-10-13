import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { Card, ErrorBox, Spinner } from '../../components/ui'
import { CATEGORY_ICON, learnText, youtubeEmbed, youtubeId } from '../../domain/learn'
import { formatShortDate, tokyoParts } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { errorMessage } from '../../lib/format'
import { usePhotoUrls, useLearnItem } from './data'

/** One manual / video page: video, summary, numbered steps with photos, よくある間違い. */
export function LearnItemPage() {
  const { t } = useTranslation('learn')
  const { id } = useParams()
  const { isManager } = useAuth()
  const locale = currentLocale()
  const [forceJa, setForceJa] = useState(false)
  const item = useLearnItem(id)
  const photos = usePhotoUrls((item.data?.steps ?? []).flatMap((s) => (s.image ? [s.image] : [])))

  if (item.isLoading) return <Spinner />
  if (item.error) return <ErrorBox message={errorMessage(item.error)} />
  const it = item.data
  if (!it) return <Card className="text-muted">{t('notFound')}</Card>

  const shown = learnText(it, locale, forceJa)
  const canTranslate = locale !== 'ja' && learnText(it, locale).translated
  const yt = youtubeId(it.video_url)
  const mistakes = shown.mistakes.split('\n').map((l) => l.trim()).filter(Boolean)
  const backTo = it.kind === 'video' ? '/learn/videos' : '/learn/manual'

  return (
    <article className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link to={backTo} className="flex min-h-11 items-center font-bold text-brand">
          ‹ {t(`${it.kind}.title`)}
        </Link>
        {isManager && (
          <Link to={`/learn/edit/${it.id}`} className="flex min-h-11 items-center rounded-xl border-[1.5px] border-brand bg-white px-3 font-bold text-brand-dark">
            ✏️ {t('manager:learn.editButton')}
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-sky-100 px-2 py-0.5 font-bold text-sky-900">
            {CATEGORY_ICON[it.category]} {t(`category.${it.category}`)}
          </span>
          {it.recommended && <span className="font-bold text-amber-700">⭐ {t('recommended')}</span>}
          {!it.published && <span className="rounded-md bg-slate-200 px-2 py-0.5 font-bold text-slate-700">{t('draft')}</span>}
        </p>
        <h1 className="text-[23px] leading-tight font-bold">{shown.title}</h1>
      </div>

      {locale !== 'ja' &&
        (canTranslate ? (
          <button type="button" onClick={() => setForceJa((v) => !v)} className="min-h-11 self-start rounded-xl border-[1.5px] border-brand bg-white px-3 font-bold text-brand-dark">
            {forceJa ? t('showMine') : t('showJa')}
          </button>
        ) : (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{t('notTranslated')}</p>
        ))}

      {yt && (
        <div className="flex flex-col gap-1">
          <div className="overflow-hidden rounded-2xl bg-black">
            <iframe
              src={youtubeEmbed(yt, locale)}
              title={shown.title}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <a href={it.video_url!} target="_blank" rel="noreferrer" className="self-end text-sm font-bold text-brand underline">
            {t('video.openYoutube')}
          </a>
        </div>
      )}

      {shown.summary && <p className="text-[17px] whitespace-pre-wrap">{shown.summary}</p>}

      {it.steps.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-bold">{t('steps')}</h2>
          <ol className="flex flex-col gap-3">
            {it.steps.map((s, i) => {
              const url = s.image ? photos.data?.get(s.image) : undefined
              return (
                <li key={i} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3">
                  <p className="flex gap-3">
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="pt-1 text-[17px] whitespace-pre-wrap">{shown.steps[i]}</span>
                  </p>
                  {s.image &&
                    (url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={t('stepPhoto', { n: i + 1 })} loading="lazy" className="w-full rounded-xl bg-slate-100" />
                      </a>
                    ) : (
                      <div className="aspect-[4/3] w-full animate-pulse rounded-xl bg-slate-100" />
                    ))}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {mistakes.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <h2 className="font-bold text-amber-900">⚠️ {t('mistakes')}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-muted">{t('updated', { date: formatShortDate(tokyoParts(new Date(it.updated_at)).date) })}</p>
    </article>
  )
}
