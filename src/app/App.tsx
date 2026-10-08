import { useTranslation } from 'react-i18next'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Button, ErrorBox, Spinner } from '../components/ui'
import { LoginPage } from '../features/auth/LoginPage'
import { UpdatePasswordPage } from '../features/auth/UpdatePasswordPage'
import { ChoreiFormPage } from '../features/chorei/ChoreiFormPage'
import { GenkoPage } from '../features/genko/GenkoPage'
import { HistoryPage } from '../features/history/HistoryPage'
import { RosterPage } from '../features/manager/RosterPage'
import { SyncPage } from '../features/manager/SyncPage'
import { UsersPage } from '../features/manager/UsersPage'
import { PatrolFormPage } from '../features/patrol/PatrolFormPage'
import { FullNamePage, InactivePage, PendingPage, PrivacyPage } from '../features/profile/GatePages'
import { ProfilePage } from '../features/profile/ProfilePage'
import { errorMessage } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from './auth'
import { HomePage } from './HomePage'
import { Layout } from './Layout'

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
  if (!profile.full_name) return <FullNamePage />
  if (profile.status === 'pending') return <PendingPage />
  if (!profile.privacy_accepted_at) return <PrivacyPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="chorei" element={<ChoreiFormPage />} />
        {canPatrol && <Route path="patrol" element={<PatrolFormPage />} />}
        <Route path="history" element={<HistoryPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {isManager && <Route path="manager/users" element={<UsersPage />} />}
        {isManager && <Route path="manager/sync" element={<SyncPage />} />}
        {isManager && <Route path="manager/roster" element={<RosterPage />} />}
        {isManager && <Route path="manager" element={<Navigate to="/manager/users" replace />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <HashRouter>
      <Gate />
    </HashRouter>
  )
}
