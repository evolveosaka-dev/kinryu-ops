import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Button, ErrorBox, Spinner } from '../components/ui'
import { LoginPage } from '../features/auth/LoginPage'
import { UpdatePasswordPage } from '../features/auth/UpdatePasswordPage'
import { ChoreiFormPage } from '../features/chorei/ChoreiFormPage'
import { GenkoPage } from '../features/genko/GenkoPage'
import { HistoryPage } from '../features/history/HistoryPage'
import { PatrolFormPage } from '../features/patrol/PatrolFormPage'
import { FullNamePage, InactivePage, PendingPage, PrivacyPage, RejectedPage } from '../features/profile/GatePages'
import { ProfilePage } from '../features/profile/ProfilePage'
import { errorMessage } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { STAFF_ISSUES_ENABLED } from '../domain/issues'
import { useAuth } from './auth'
import { HomePage } from './HomePage'
import { Layout } from './Layout'

// Manager screens are loaded only for managers (keeps the staff bundle small).
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }))
const DashboardPage = page(() => import('../features/manager/DashboardPage'), 'DashboardPage')
const ChoreiAdminPage = page(() => import('../features/manager/ChoreiAdminPage'), 'ChoreiAdminPage')
const PatrolAdminPage = page(() => import('../features/manager/PatrolAdminPage'), 'PatrolAdminPage')
const PatrolBackfillPage = page(() => import('../features/manager/PatrolBackfillPage'), 'PatrolBackfillPage')
const StaffPage = page(() => import('../features/manager/StaffPage'), 'StaffPage')
const StatsPage = page(() => import('../features/manager/StatsPage'), 'StatsPage')
const SettingsPage = page(() => import('../features/manager/SettingsPage'), 'SettingsPage')
const TargetsPage = page(() => import('../features/manager/TargetsPage'), 'TargetsPage')
const UsersPage = page(() => import('../features/manager/UsersPage'), 'UsersPage')
const RosterPage = page(() => import('../features/manager/RosterPage'), 'RosterPage')
const SyncPage = page(() => import('../features/manager/SyncPage'), 'SyncPage')
const NotifyPage = page(() => import('../features/manager/NotifyPage'), 'NotifyPage')
const ShiftRequestsAdminPage = page(() => import('../features/manager/ShiftRequestsAdminPage'), 'ShiftRequestsAdminPage')
const ShiftImportPage = page(() => import('../features/manager/ShiftImportPage'), 'ShiftImportPage')
const SchedulePage = page(() => import('../features/schedule/SchedulePage'), 'SchedulePage')
const AllShiftsPage = page(() => import('../features/schedule/AllShiftsPage'), 'AllShiftsPage')
const ManualListPage = page(() => import('../features/learn/LearnListPage'), 'ManualListPage')
const VideoListPage = page(() => import('../features/learn/LearnListPage'), 'VideoListPage')
const SkillsPage = page(() => import('../features/learn/LearnListPage'), 'SkillsPage')
const LearnItemPage = page(() => import('../features/learn/LearnItemPage'), 'LearnItemPage')
const LearnEditPage = page(() => import('../features/learn/LearnEditPage'), 'LearnEditPage')
const SalesPage = page(() => import('../features/sales/SalesPage'), 'SalesPage')
const SalesAdminPage = page(() => import('../features/manager/SalesAdminPage'), 'SalesAdminPage')
const AnalysisPage = page(() => import('../features/manager/analysis/AnalysisPage'), 'AnalysisPage')
const StockPage = page(() => import('../features/stock/StockPage'), 'StockPage')
const StockItemsPage = page(() => import('../features/manager/StockItemsPage'), 'StockItemsPage')
const ShiftRequestPage = page(() => import('../features/shift/ShiftRequestPage'), 'ShiftRequestPage')

/** Decides which screen a visitor may see: login → approval → privacy notice → app. */
function Gate() {
  const { t } = useTranslation()
  const { session, initializing, recovery, profile, profileLoading, profileError, refreshProfile, canPatrol, isManager } = useAuth()

  const location = useLocation()

  // 朝礼原稿 is public: shareable link / QR code, no login needed
  if (location.pathname === '/genko') return <GenkoPage />
  if (!isConfigured) return <ErrorBox message={t('error.notConfigured')} />
  if (initializing) return <Spinner label={t('action.loading')} />
  if (recovery && session) return <UpdatePasswordPage />
  if (!session) return <LoginPage />
  if (profileLoading) return <Spinner label={t('action.loading')} />
  if (!profile) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <ErrorBox message={profileError ? errorMessage(profileError) : t('error.generic')} />
        <Button onClick={() => void refreshProfile()}>{t('action.retry')}</Button>
        <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
          {t('action.signOut')}
        </Button>
      </div>
    )
  }
  if (profile.status === 'inactive') return <InactivePage />
  if (profile.status === 'rejected') return <RejectedPage />
  if (!profile.full_name) return <FullNamePage />
  if (profile.status === 'pending') return <PendingPage />
  if (!profile.privacy_accepted_at) return <PrivacyPage />

  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="chorei" element={<ChoreiFormPage />} />
        {canPatrol && <Route path="patrol" element={<PatrolFormPage />} />}
        <Route path="history" element={<HistoryPage />} />
        <Route path="shift-request" element={<ShiftRequestPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="sales" element={<SalesPage />} />
        {isManager && <Route path="all-shifts" element={<AllShiftsPage />} />}
        <Route path="profile" element={<ProfilePage />} />
        <Route path="learn/manual" element={<ManualListPage />} />
        <Route path="learn/videos" element={<VideoListPage />} />
        <Route path="learn/skills" element={<SkillsPage />} />
        <Route path="learn/:id" element={<LearnItemPage />} />
        {isManager && <Route path="learn/edit/:id" element={<LearnEditPage />} />}
        {isManager && (
          <Route path="manager">
            <Route index element={<DashboardPage />} />
            <Route path="chorei" element={<ChoreiAdminPage />} />
            <Route path="patrol" element={<PatrolAdminPage />} />
            <Route path="patrol/new" element={<PatrolBackfillPage />} />
            {STAFF_ISSUES_ENABLED && <Route path="staff" element={<StaffPage />} />}
            <Route path="stats" element={<StatsPage />} />
            {/* 巡回時間 is a section of 巡回 now */}
            <Route path="hours" element={<Navigate to="/manager/patrol" replace />} />
            <Route path="sales" element={<SalesAdminPage />} />
            <Route path="analysis" element={<AnalysisPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="targets" element={<TargetsPage />} />
            <Route path="stock-items" element={<StockItemsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="roster" element={<RosterPage />} />
            <Route path="sync" element={<SyncPage />} />
            <Route path="notify" element={<NotifyPage />} />
            <Route path="shift-requests" element={<ShiftRequestsAdminPage />} />
            <Route path="shift-import" element={<ShiftImportPage />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}

export function App() {
  return (
    <HashRouter>
      <Gate />
    </HashRouter>
  )
}
