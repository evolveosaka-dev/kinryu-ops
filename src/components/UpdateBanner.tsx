import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_EVERY_MS = 30 * 60 * 1000

/**
 * A new version is installed in the background; the staff member decides when to reload
 * (never automatically — a half-filled form would be lost).
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined)
      }
      // home-screen apps are resumed rather than reopened: check when they come back too
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-lg items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-lg sm:mx-auto"
      style={{ width: 'calc(100% - 2rem)' }}
    >
      <span className="flex-1 text-[15px] font-bold">🆕 {t('update.available')}</span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="min-h-11 shrink-0 rounded-xl bg-white px-4 font-bold text-brand-dark hover:bg-brand-soft"
      >
        {t('update.button')}
      </button>
    </div>
  )
}
