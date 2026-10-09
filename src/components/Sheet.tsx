import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Full-screen panel for record details. */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-center bg-black/50">
      <div className="flex max-h-dvh w-full max-w-lg flex-col bg-white">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 text-xl" aria-label={t('action.close')}>
            ✕
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
