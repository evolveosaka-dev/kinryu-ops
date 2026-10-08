import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { cx } from '../../lib/cx'

export function ManagerTabs() {
  const { t } = useTranslation('manager')
  const tabs = [
    { to: '/manager/users', label: `👥 ${t('users.title')}` },
    { to: '/manager/roster', label: `📋 ${t('roster.tab')}` },
    { to: '/manager/sync', label: `📊 ${t('sync.tab')}` },
  ]
  return (
    <nav className="grid grid-cols-3 gap-2">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cx('flex min-h-11 items-center justify-center rounded-xl text-sm font-bold', isActive ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-300')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
