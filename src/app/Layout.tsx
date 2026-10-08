import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { UploadStatus } from '../features/attachments/UploadStatus'
import { cx } from '../lib/cx'
import { useAuth } from './auth'

export function Layout() {
  const { t } = useTranslation()
  const { canPatrol, isManager, profile } = useAuth()

  const items = [
    { to: '/', icon: '🏠', label: t('nav.home') },
    { to: '/chorei', icon: '📣', label: t('nav.chorei') },
    ...(canPatrol ? [{ to: '/patrol', icon: '🔍', label: t('nav.patrol') }] : []),
    { to: '/history', icon: '🗂️', label: t('nav.history') },
    ...(isManager ? [{ to: '/manager', icon: '🛠️', label: t('nav.manager') }] : []),
    { to: '/profile', icon: '⚙️', label: t('nav.profile') },
  ]

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-brand px-4 py-3 text-white">
        <span className="font-bold">{t('app.title')}</span>
        <span className="text-sm opacity-90">{profile?.display_name}</span>
      </header>
      <UploadStatus />
      <main className="flex-1 px-4 pt-4 pb-24">
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
        aria-label="main"
      >
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) =>
              cx('flex min-h-14 flex-1 flex-col items-center justify-center text-xs', isActive ? 'font-bold text-brand' : 'text-slate-600')
            }
          >
            <span aria-hidden className="text-xl leading-none">
              {i.icon}
            </span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
