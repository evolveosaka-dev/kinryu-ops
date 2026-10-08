import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import i18n, { isLocale } from '../i18n'
import { unwrap } from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  initializing: boolean
  /** true after opening a password-reset link */
  recovery: boolean
  clearRecovery: () => void
  profile: Profile | null
  profileLoading: boolean
  profileError: Error | null
  refreshProfile: () => Promise<unknown>
  isManager: boolean
  canPatrol: boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setInitializing(false)
      // remove ?code=… left by the OAuth / e-mail PKCE redirect
      if (window.location.search.includes('code=')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
      }
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => unwrap<Profile>(await supabase.from('profiles').select('*').eq('id', userId!).single()),
    retry: 3,
  })
  const profile = profileQuery.data ?? null

  // The saved profile language wins over the browser language.
  useEffect(() => {
    if (profile && isLocale(profile.locale) && !i18n.language.startsWith(profile.locale)) {
      void i18n.changeLanguage(profile.locale)
    }
  }, [profile])

  const active = profile?.status === 'active'
  const value: AuthState = {
    session,
    initializing,
    recovery,
    clearRecovery: () => setRecovery(false),
    profile,
    profileLoading: profileQuery.isLoading,
    profileError: profileQuery.error,
    refreshProfile: () => profileQuery.refetch(),
    isManager: active && (profile?.role === 'manager' || profile?.role === 'admin'),
    canPatrol: active && Boolean(profile?.can_patrol),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Signed-in, approved user (only call below the auth gate). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMe(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('profile not loaded')
  return profile
}
