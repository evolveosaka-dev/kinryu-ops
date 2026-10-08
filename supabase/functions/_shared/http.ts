import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback
  if (v === undefined) throw new HttpError(500, `missing secret ${name}`)
  return v
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function allowedOrigins(): string[] {
  return env('APP_ORIGINS', 'https://evolveosaka-dev.github.io,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
}

/** The request origin when it is one of ours (used for CORS and for the Drive upload session). */
export function appOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin')
  return origin && allowedOrigins().includes(origin) ? origin : null
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = appOrigin(req)
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
      }
    : {}
}

export function serve(handler: (req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    try {
      const body = await handler(req)
      return Response.json(body, { headers: corsHeaders(req) })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof Error ? err.message : String(err)
      if (status >= 500) console.error(err)
      return Response.json({ error: message }, { status, headers: corsHeaders(req) })
    }
  })
}

/** Service-role client: bypasses RLS, only for server-side checks and writes. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface Caller {
  id: string
  role: 'staff' | 'manager' | 'admin'
  canPatrol: boolean
  isManager: boolean
}

/** Validate the user's access token and require an active profile. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'not signed in')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'invalid session')
  const { data: p } = await admin.from('profiles').select('role, status, can_patrol').eq('id', data.user.id).single()
  if (!p || p.status !== 'active') throw new HttpError(403, 'account not active')
  const isManager = p.role === 'manager' || p.role === 'admin'
  return { id: data.user.id, role: p.role, canPatrol: p.can_patrol, isManager }
}
