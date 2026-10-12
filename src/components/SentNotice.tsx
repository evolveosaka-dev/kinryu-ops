import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTokyoTime } from '../domain/time'
import { Button } from './ui'

export interface SentInfo {
  /** what was sent, e.g. 朝礼記録 */
  kind: string
  /** e.g. 10/12(月) 早番・御堂筋店 */
  detail?: string
  /** photos / videos still uploading in the background */
  photos?: number
}

const SentContext = createContext<(info: SentInfo) => void>(() => {})

/** A confirmation that stays on screen until the user taps OK, so nobody misses that a report was sent. */
export function SentNoticeProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<(SentInfo & { at: Date }) | null>(null)
  const show = useCallback((i: SentInfo) => setInfo({ ...i, at: new Date() }), [])

  return (
    <SentContext.Provider value={show}>
      {children}
      {info && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="sent-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-xl">
            <span className="flex size-16 items-center justify-center rounded-full bg-green-100 text-4xl" aria-hidden>
              ✅
            </span>
            <h2 id="sent-title" className="text-xl font-bold">
              {t('sent.title')}
            </h2>
            <p className="font-bold text-slate-800">{info.kind}</p>
            {info.detail && <p className="text-slate-700">{info.detail}</p>}
            <p className="text-sm text-slate-600">{t('sent.time', { time: formatTokyoTime(info.at) })}</p>
            <p className="text-sm">{t('sent.body')}</p>
            {Boolean(info.photos) && <p className="text-sm text-slate-600">{t('sent.photos', { n: info.photos })}</p>}
            <Button className="w-full" onClick={() => setInfo(null)}>
              {t('sent.ok')}
            </Button>
          </div>
        </div>
      )}
    </SentContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSentNotice = () => useContext(SentContext)
