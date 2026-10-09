import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { UploadStatus } from '../features/attachments/UploadStatus'
import { cx } from '../lib/cx'
import { initials } from '../lib/format'
import { useAuth } from './auth'

export function Layout() {
  const { t } = useTranslation()
  const { canPatrol, isManager, profile } = useAuth()

  const items: { to: string; icon: IconName; label: string }[] = [
    { to: '/', icon: 'home', label: t('nav.home') },
    { to: '/chorei', icon: 'megaphone', label: t('nav.chorei') },
    ...(canPatrol ? [{ to: '/patrol', icon: 'clipboard' as const, label: t('nav.patrol') }] : []),
    { to: '/history', icon: 'history', label: t('nav.history') },
    ...(isManager ? [{ to: '/manager', icon: 'chart' as const, label: t('nav.manager') }] : []),
    { to: '/profile', icon: 'settings', label: t('nav.profile') },
  ]

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-white">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden>
            金
          </span>
          <span className="text-[15px] font-bold tracking-tight">{t('app.title')}</span>
        </Link>
        <Link to="/profile" className="flex size-9 items-center justify-center rounded-full bg-surface text-xs font-bold text-ink ring-1 ring-line" aria-label={t('nav.profile')}>
          {initials(profile?.display_name || profile?.full_name || '?')}
        </Link>
      </header>
      <UploadStatus />
      <main className="flex-1 px-4 pt-5 pb-28">
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
        aria-label="main"
      >
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) =>
              cx('flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'font-semibold text-ink' : 'text-slate-400')
            }
          >
            {({ isActive }) => (
              <>
                <Icon name={i.icon} size={22} className={isActive ? 'text-ink' : 'text-slate-400'} />
                {i.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
