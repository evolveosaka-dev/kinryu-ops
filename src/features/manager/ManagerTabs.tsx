import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router'
import { cx } from '../../lib/cx'

const SETTINGS_PATHS = ['/manager/settings', '/manager/users', '/manager/roster', '/manager/sync', '/manager/targets']

export function ManagerTabs() {
  const { t } = useTranslation('manager')
  const { pathname } = useLocation()
  const tabs = [
    { to: '/manager', label: `📊 ${t('tabs.dashboard')}`, end: true },
    { to: '/manager/chorei', label: `📣 ${t('tabs.chorei')}` },
    { to: '/manager/patrol', label: `🔍 ${t('tabs.patrol')}` },
    { to: '/manager/stats', label: `📈 ${t('tabs.stats')}` },
    { to: '/manager/hours', label: `⏱️ ${t('tabs.hours')}` },
    { to: '/manager/settings', label: `⚙️ ${t('tabs.settings')}`, settings: true },
  ]
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="manager">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cx(
              'flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-bold whitespace-nowrap',
              isActive || (tab.settings && SETTINGS_PATHS.includes(pathname)) ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-300',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
