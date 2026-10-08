import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

// Anon key only. All data access is protected by Auth + RLS.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: {
    // PKCE returns ?code=… instead of #access_token=…, which would clash with HashRouter.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** Where OAuth / e-mail links return to: the app root, without the hash route. */
export function appBaseUrl(): string {
  const configured = import.meta.env.VITE_APP_BASE_URL as string | undefined
  return configured ?? `${window.location.origin}${window.location.pathname}`
}
