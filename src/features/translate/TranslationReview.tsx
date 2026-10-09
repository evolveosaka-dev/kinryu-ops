import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui'
import { currentLocale } from '../../i18n'

export interface ReviewItem {
  key: string
  label: string
  original: string
  ja: string
  back: string
}

/** Full-screen check: original, editable Japanese, and the meaning back in the writer's language. */
export function TranslationReview({
  items,
  onConfirm,
  onCancel,
}: {
  items: ReviewItem[]
  onConfirm: (ja: Record<string, string>) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [ja, setJa] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.key, i.ja])))
  const showBack = currentLocale() !== 'ja'

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="translate-title" className="fixed inset-0 z-50 flex justify-center bg-black/50">
      <div className="flex max-h-dvh w-full max-w-lg flex-col bg-white">
        <header className="bg-brand px-4 py-3 text-white">
          <h2 id="translate-title" className="font-bold">
            {t('translate.title')}
          </h2>
          <p className="text-sm opacity-90">{t('translate.body')}</p>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {items.map((item) => {
            const edited = ja[item.key] !== item.ja
            return (
              <section key={item.key} className="flex flex-col gap-2 rounded-2xl bg-white p-3 border border-line">
                <h3 className="font-bold">{item.label}</h3>
                <div>
                  <p className="text-xs font-bold text-slate-500">{t('translate.original')}</p>
                  <p className="text-sm whitespace-pre-wrap text-slate-700">{item.original}</p>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-brand">{t('translate.japanese')}</span>
                  <textarea
                    lang="ja"
                    rows={3}
                    maxLength={1000}
                    value={ja[item.key] ?? ''}
                    onChange={(e) => setJa((prev) => ({ ...prev, [item.key]: e.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-brand/40 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none"
                  />
                </label>
                {showBack && (
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-xs font-bold text-slate-500">{t('translate.back')}</p>
                    <p className="text-sm whitespace-pre-wrap">{item.back}</p>
                    {edited && <p className="mt-1 text-xs text-amber-800">{t('translate.editedNote')}</p>}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="secondary" onClick={onCancel}>
            {t('translate.rewrite')}
          </Button>
          <Button onClick={() => onConfirm(ja)} disabled={items.some((i) => !(ja[i.key] ?? '').trim())}>
            {t('translate.confirm')}
          </Button>
        </footer>
      </div>
    </div>
  )
}
