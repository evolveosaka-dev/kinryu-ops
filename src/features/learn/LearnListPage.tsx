import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { Card, ErrorBox, PageTitle, SectionTitle, Spinner, TextInput } from '../../components/ui'
import { CATEGORY_ICON, LEARN_CATEGORIES, learnText, matchesSearch, sortItems, youtubeId, youtubeThumb, type LearnItem, type LearnKind } from '../../domain/learn'
import { currentLocale } from '../../i18n'
import { errorMessage } from '../../lib/format'
import { useLearnItems } from './data'

function ItemRow({ item }: { item: LearnItem }) {
  const { t } = useTranslation('learn')
  const shown = learnText(item, currentLocale())
  const yt = youtubeId(item.video_url)
  return (
    <li>
      <Link to={`/learn/${item.id}`} className="flex items-center gap-3 p-3 hover:bg-surface">
        {item.kind === 'video' && yt ? (
          <img src={youtubeThumb(yt)} alt="" loading="lazy" className="aspect-video w-28 shrink-0 rounded-lg bg-slate-200 object-cover" />
        ) : (
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-xl">
            {CATEGORY_ICON[item.category]}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-bold">
            {item.recommended && <span aria-label={t('recommended')}>⭐ </span>}
            {shown.title}
          </span>
          {shown.summary && <span className="line-clamp-2 text-sm text-muted">{shown.summary}</span>}
          <span className="flex flex-wrap gap-1.5 text-xs">
            {item.kind === 'manual' && item.steps.length > 0 && <span className="text-muted">{t('stepsCount', { n: item.steps.length })}</span>}
            {!item.published && <span className="rounded bg-slate-200 px-1.5 font-bold text-slate-700">{t('draftShort')}</span>}
          </span>
        </span>
        <span aria-hidden className="text-xl text-slate-500">
          ›
        </span>
      </Link>
    </li>
  )
}

function ItemList({ items }: { items: LearnItem[] }) {
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <ItemRow key={i.id} item={i} />
        ))}
      </ul>
    </Card>
  )
}

/** 学ぶ → 仕事のマニュアル / 見本動画: おすすめ, then by category; search over the shown text and the Japanese. */
export function LearnListPage({ kind }: { kind: LearnKind }) {
  const { t } = useTranslation('learn')
  const { isManager } = useAuth()
  const [query, setQuery] = useState('')
  const items = useLearnItems(kind)
  const locale = currentLocale()

  const all = sortItems(items.data ?? [])
  const found = query.trim() ? all.filter((i) => matchesSearch(i, learnText(i, locale), query)) : null
  const recommended = all.filter((i) => i.recommended)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={t(`${kind}.title`)}
        action={
          isManager && (
            <Link to={`/learn/edit/new?kind=${kind}`} className="flex min-h-11 items-center rounded-xl bg-brand px-3 font-bold text-white hover:bg-brand-dark">
              ＋ {t('manager:learn.add')}
            </Link>
          )
        }
      />
      {all.length > 0 && (
        <TextInput label={t('search')} type="search" placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      {items.isLoading ? (
        <Spinner />
      ) : items.error ? (
        <ErrorBox message={errorMessage(items.error)} />
      ) : all.length === 0 ? (
        <Card className="text-muted">{t(`${kind}.empty`)}</Card>
      ) : found ? (
        found.length === 0 ? <Card className="text-muted">{t('noMatch')}</Card> : <ItemList items={found} />
      ) : (
        <>
          {recommended.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionTitle>⭐ {t('recommended')}</SectionTitle>
              <ItemList items={recommended} />
            </section>
          )}
          {LEARN_CATEGORIES.map((c) => {
            const list = all.filter((i) => i.category === c && !i.recommended)
            if (list.length === 0) return null
            return (
              <section key={c} className="flex flex-col gap-2">
                <SectionTitle>
                  {CATEGORY_ICON[c]} {t(`category.${c}`)}
                </SectionTitle>
                <ItemList items={list} />
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

/** 学ぶ → スキルアップ: coming in the next stage. */
export function SkillsPage() {
  const { t } = useTranslation('learn')
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('skills.title')} />
      <Card className="flex flex-col gap-2">
        <p className="text-lg font-bold">🚧 {t('skills.soon')}</p>
        <p>{t('skills.body')}</p>
      </Card>
    </div>
  )
}

export const ManualListPage = () => <LearnListPage kind="manual" />
export const VideoListPage = () => <LearnListPage kind="video" />
