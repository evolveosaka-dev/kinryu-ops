import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router'
import { STAFF_ISSUES_ENABLED } from '../../domain/issues'
import { cx } from '../../lib/cx'
import { useFillTargets } from './useFillTargets'
import { useIsPayrollAdmin } from './payroll/data'

const SETTINGS_PATHS = ['/manager/settings', '/manager/users', '/manager/roster', '/manager/sync', '/manager/system', '/manager/targets', '/manager/shift-requests', '/manager/shift-import', '/manager/stock-items', '/manager/notify', '/manager/emergency-contacts', '/manager/equipment']

export function ManagerTabs() {
  const { t } = useTranslation('manager')
  const { pathname } = useLocation()
  // every 管理 page: 朝礼 records without 目標杯数 get it from the targets
  useFillTargets()
  // 給与計算: System Admin only
  const payroll = useIsPayrollAdmin()
  const tabs = [
    { to: '/manager', label: `${t('tabs.dashboard')}`, end: true },
    { to: '/manager/chorei', label: `${t('tabs.chorei')}` },
    { to: '/manager/patrol', label: `${t('tabs.patrol')}` },
    ...(STAFF_ISSUES_ENABLED ? [{ to: '/manager/staff', label: `${t('tabs.staff')}` }] : []),
    { to: '/manager/attendance', label: `${t('tabs.attendance')}` },
    { to: '/manager/incidents', label: `${t('tabs.incidents')}` },
    { to: '/manager/lost-items', label: `${t('tabs.lost')}` },
    { to: '/manager/stats', label: `${t('tabs.stats')}` },
    { to: '/manager/sales', label: `${t('tabs.sales')}` },
    { to: '/manager/analysis', label: `${t('tabs.analysis')}` },
    { to: '/manager/reports', label: `${t('tabs.reports')}` },
    ...(payroll ? [{ to: '/manager/payroll', label: `${t('tabs.payroll')}` }] : []),
    { to: '/manager/settings', label: `${t('tabs.settings')}`, settings: true },
  ]
  return (
    <nav className="-mx-4 flex gap-5 overflow-x-auto border-b border-line px-4" aria-label="manager">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cx(
              '-mb-px flex min-h-11 shrink-0 items-center border-b-2 text-sm whitespace-nowrap',
              isActive || (tab.settings && SETTINGS_PATHS.includes(pathname)) ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
