import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'

type Phone = 'iphone' | 'android'
const STEPS = ['s1', 's2', 's3', 's4'] as const

/** The phone the app runs on (iPadOS reports a Mac with touch). */
// eslint-disable-next-line react-refresh/only-export-components
export function detectPhone(ua = navigator.userAgent, touch = navigator.maxTouchPoints): Phone | null {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iphone'
  if (/Android/.test(ua)) return 'android'
  return null
}

/** How to make videos smaller on iPhone / Android (camera settings for the next videos, trimming for this one). */
export function VideoSizeGuide() {
  const { t } = useTranslation()
  const [phone, setPhone] = useState<Phone>(() => detectPhone() ?? 'iphone')
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-3 text-sm text-slate-800 ring-1 ring-blue-200">
      <p className="font-bold">🎥 {t('videoGuide.title')}</p>
      <p>{t('videoGuide.intro')}</p>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {(['iphone', 'android'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={phone === p}
            onClick={() => setPhone(p)}
            className={cx('min-h-10 rounded-md font-bold', phone === p ? 'bg-white text-blue-900 shadow' : 'text-slate-600')}
          >
            {p === 'iphone' ? '📱 iPhone' : '🤖 Android'}
          </button>
        ))}
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        {STEPS.map((s) => (
          <li key={s}>{t(`videoGuide.${phone}.${s}`)}</li>
        ))}
      </ol>
      <p className="text-xs text-slate-600">{t('videoGuide.note')}</p>
    </div>
  )
}
