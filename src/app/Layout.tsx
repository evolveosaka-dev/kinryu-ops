import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router'
import { UploadStatus } from '../features/attachments/UploadStatus'
import { cx } from '../lib/cx'
import { initials } from '../lib/format'
import { useAuth } from './auth'

export function Layout() {
  const { t } = useTranslation()
  const { canPatrol, isManager, profile } = useAuth()

  // Coloured icons + text: recognisable at a glance for staff who read Japanese slowly.
  const items = [
    { to: '/', icon: '🏠', label: t('nav.home') },
    { to: '/chorei', icon: '📣', label: t('nav.chorei') },
    ...(canPatrol ? [{ to: '/patrol', icon: '🔍', label: t('nav.patrol') }] : []),
    { to: '/history', icon: '🗂️', label: t('nav.history') },
    ...(isManager ? [{ to: '/manager', icon: '📊', label: t('nav.manager') }] : []),
    { to: '/profile', icon: '⚙️', label: t('nav.profile') },
  ]

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-surface">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-brand px-4 py-3 text-white">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-white text-[15px] font-bold text-brand" aria-hidden>
            金
          </span>
          <span className="text-[17px] font-bold">{t('app.title')}</span>
        </Link>
        <Link to="/profile" className="flex size-9 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white" aria-label={t('nav.profile')}>
          {initials(profile?.display_name || profile?.full_name || '?')}
        </Link>
      </header>
      <UploadStatus />
      <main className="flex-1 px-4 pt-5 pb-28">
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg gap-1 border-t border-line bg-white px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        aria-label="main"
      >
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs',
                isActive ? 'bg-brand-soft font-bold text-brand' : 'text-slate-600',
              )
            }
          >
            <span aria-hidden className="text-[21px] leading-none">
              {i.icon}
            </span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
