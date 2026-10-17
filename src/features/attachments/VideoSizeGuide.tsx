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

const IOS = ['ios27', 'ios26', 'older'] as const

/** Which iOS row fits this iPhone: Safari reports its version as `Version/27.0` (other browsers don't, so no guess). */
// eslint-disable-next-line react-refresh/only-export-components
export function iosRow(ua = navigator.userAgent): (typeof IOS)[number] | null {
  const v = Number(/Version\/(\d+)/.exec(ua)?.[1])
  if (!v || detectPhone(ua, 5) !== 'iphone') return null
  return v >= 27 ? 'ios27' : v === 26 ? 'ios26' : 'older'
}

/**
 * Step-by-step help with iPhone / Android tabs; texts at `<k>.title / intro / iphone.s1–s4 / android.s1–s4 / note`.
 * A step may have per-iOS rows at `<step>v.ios27 / ios26 / older` (the row for this iPhone is marked), plus `<k>.version`.
 */
export function PhoneGuide({ k, icon }: { k: 'videoGuide' | 'installGuide'; icon?: string }) {
  const { t, i18n } = useTranslation()
  const mine = iosRow()
  const [phone, setPhone] = useState<Phone>(() => detectPhone() ?? 'iphone')
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-3 text-sm text-slate-800 ring-1 ring-blue-200">
      {icon && (
        <p className="font-bold">
          {icon} {t(`${k}.title`)}
        </p>
      )}
      <p>{t(`${k}.intro`)}</p>
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
          <li key={s}>
            {t(`${k}.${phone}.${s}`)}
            {i18n.exists(`${k}.${phone}.${s}v`) && (
              <ul className="mt-1 flex flex-col gap-1">
                {IOS.map((v) => (
                  <li key={v} className={cx('rounded-md px-2 py-1', v === mine ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-slate-50')}>
                    {t(`${k}.${phone}.${s}v.${v}`)}
                    {v === mine && <span className="ml-1 rounded bg-amber-200 px-1.5 text-xs font-bold text-amber-950">← {t(`${k}.thisPhone`)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {phone === 'iphone' && i18n.exists(`${k}.version`) && <p className="text-xs text-slate-600">ℹ️ {t(`${k}.version`)}</p>}
      <p className="text-xs text-slate-600">{t(`${k}.note`)}</p>
    </div>
  )
}

/** How to make videos smaller on iPhone / Android (camera settings for the next videos, trimming for this one). */
export function VideoSizeGuide() {
  return <PhoneGuide k="videoGuide" icon="🎥" />
}
