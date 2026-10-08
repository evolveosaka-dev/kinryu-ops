import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { LanguageSelect } from '../../components/LanguageSelect'
import { Card } from '../../components/ui'
import { GENKO_STEPS, parseRuby, PREP_QUESTION, type SpokenLine } from '../../domain/genko'
import { CAUTION_PICKS } from '../../domain/phrases'
import { currentLocale } from '../../i18n'

const FURIGANA_KEY = 'kinryu.genko.furigana'

function Ruby({ text, furigana }: { text: string; furigana: boolean }) {
  return (
    <span lang="ja">
      {parseRuby(text).map((seg, i) =>
        seg.reading && furigana ? (
          <ruby key={i}>
            {seg.text}
            <rt className="text-[0.6em] font-normal text-slate-500">{seg.reading}</rt>
          </ruby>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  )
}

function Line({ line, furigana }: { line: SpokenLine; furigana: boolean }) {
  const { t } = useTranslation('genko')
  const ja = currentLocale() === 'ja'
  return (
    <li className="flex flex-col">
      <span className="text-lg leading-loose font-bold">
        「<Ruby text={line.ja} furigana={furigana} />」{line.twice && <span className="ml-1 text-brand">{t('twice')}</span>}
      </span>
      {!ja && (
        <>
          <span className="text-xs text-slate-500">{line.romaji}</span>
          <span className="text-sm text-slate-700">{t(line.key)}</span>
        </>
      )}
    </li>
  )
}

function duration(seconds: number, t: (k: string, o: { n: number }) => string) {
  return seconds >= 60 ? t('minutes', { n: seconds / 60 }) : t('seconds', { n: seconds })
}

/** 朝礼原稿 — public page (no login), shareable as …/#/genko */
export function GenkoPage() {
  const { t } = useTranslation('genko')
  const { session } = useAuth()
  const [furigana, setFurigana] = useState(() => {
    try {
      return localStorage.getItem(FURIGANA_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleFurigana = (v: boolean) => {
    setFurigana(v)
    try {
      localStorage.setItem(FURIGANA_KEY, v ? '1' : '0')
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-brand px-4 py-2 text-white">
        <span className="font-bold">📜 {t('title')}</span>
        <div className="flex items-center gap-2 text-slate-900">
          <label className="flex items-center gap-1 text-sm text-white">
            <input type="checkbox" className="size-5" checked={furigana} onChange={(e) => toggleFurigana(e.target.checked)} />
            {t('furigana')}
          </label>
          <LanguageSelect compact />
        </div>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-4 pb-10">
        <Card className="flex flex-col gap-1">
          <p className="font-bold">{t('subtitle')}</p>
          <p className="text-sm text-slate-600">{t('leaderBy')}</p>
          <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">📣 {t('point')}</p>
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">⏰ {t('before.title')}</h2>
          <p className="text-sm">{t('before.stock')}</p>
          <ul className="pl-4">
            <Line line={PREP_QUESTION} furigana={furigana} />
          </ul>
          <p className="text-sm">{t('before.target')}</p>
          <p className="text-sm">{t('before.caution')}</p>
        </Card>

        {GENKO_STEPS.map((step, i) => (
          <Card key={step.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{t(`chorei:steps.${step.id}`)}</h2>
              {step.seconds && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">⏱ {duration(step.seconds, t)}</span>}
            </div>
            <section>
              <h3 className="mb-1 text-xs font-bold text-brand">🎤 {t('leaderSays')}</h3>
              <ul className="flex flex-col gap-2">
                {step.leader.map((l) => (
                  <Line key={l.key} line={l} furigana={furigana} />
                ))}
              </ul>
            </section>
            <section className="rounded-xl bg-slate-50 p-3">
              <h3 className="mb-1 text-xs font-bold text-slate-600">👥 {t('allSay')}</h3>
              <p className="mb-1 text-sm">{t(`notes.${step.id}`)}</p>
              <ul className="flex flex-col gap-2">
                {step.all.map((l) => (
                  <Line key={`${l.key}-${i}`} line={l} furigana={furigana} />
                ))}
              </ul>
            </section>
          </Card>
        ))}

        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">💡 {t('cautionTitle')}</h2>
          <ul className="flex flex-col gap-2">
            {CAUTION_PICKS.map((p) => (
              <li key={p.key} className="flex flex-col">
                <span lang="ja" className="font-bold">
                  「{p.ja}」
                </span>
                {currentLocale() !== 'ja' && (
                  <>
                    <span className="text-xs text-slate-500">{p.romaji}</span>
                    <span className="text-sm text-slate-700">{t(`chorei:${p.key}`)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">🚨 {t('situations.title')}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>{t('situations.customer')}</li>
            <li>{t('situations.busy')}</li>
            <li>{t('situations.few')}</li>
          </ul>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">✅ {t('after.title')}</h2>
          <p className="text-sm">{t('after.record')}</p>
          <Link to={session ? '/chorei' : '/'} className="flex min-h-12 items-center justify-center rounded-xl bg-brand font-bold text-white">
            📣 {t('openApp')}
          </Link>
        </Card>
      </main>
    </div>
  )
}
