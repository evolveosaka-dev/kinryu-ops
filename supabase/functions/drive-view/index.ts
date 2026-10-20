// Shows 朝礼 photos / videos to the staff in the app (owner, 2026-10-20) without sharing the Drive files:
// POST { ids } with the user's token → { urls: { <attachment id>: <link> } }, links valid 2 hours. Active staff get
//   uploaded files of valid 朝礼 records (not test records); managers any uploaded file.
// GET ?a=<attachment id>&e=<expiry, unix s>&s=<HMAC> → the file from Drive, Range passed through so videos seek.
// <img> / <video> cannot send a token, hence the signed link (secret DRIVE_VIEW_SECRET).
import { googleToken } from '../_shared/google.ts'
import { adminClient, env, HttpError, jsonHandler, requireUser } from '../_shared/http.ts'

const TTL_SEC = 2 * 3600
const MAX_IDS = 60
const enc = new TextEncoder()
let keyP: Promise<CryptoKey> | null = null
const key = () => (keyP ??= crypto.subtle.importKey('raw', enc.encode(env('DRIVE_VIEW_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']))
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const sign = async (id: string, exp: number) => b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(`${id}.${exp}`))))

interface Row {
  id: string
  status: string
  chorei_id: string | null
  chorei: { status: string; is_test: boolean } | null
}

const post = jsonHandler(async (req) => {
  const admin = adminClient()
  const caller = await requireUser(req, admin)
  const body = (await req.json()) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_IDS) : []
  if (!ids.length) throw new HttpError(400, 'no ids')
  const { data, error } = await admin.from('attachments').select('id, status, chorei_id, chorei:chorei_records(status, is_test)').in('id', ids)
  if (error) throw new HttpError(500, error.message)
  const ok = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.status === 'uploaded' && (caller.isManager || (r.chorei_id !== null && r.chorei?.status === 'valid' && !r.chorei.is_test)),
  )
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC
  const base = `${env('SUPABASE_URL')}/functions/v1/drive-view`
  const urls: Record<string, string> = {}
  for (const r of ok) urls[r.id] = `${base}?a=${r.id}&e=${exp}&s=${await sign(r.id, exp)}`
  return { urls, expires: exp }
})

async function stream(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const a = u.searchParams.get('a') ?? ''
  const e = Number(u.searchParams.get('e'))
  const s = u.searchParams.get('s') ?? ''
  if (!a || !s || !e || e < Date.now() / 1000) return new Response('link expired', { status: 403 })
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', await key(), unb64u(s), enc.encode(`${a}.${e}`))
  } catch {
    valid = false
  }
  if (!valid) return new Response('bad link', { status: 403 })
  const { data } = await adminClient().from('attachments').select('drive_file_id, mime_type, status').eq('id', a).maybeSingle()
  if (!data || data.status !== 'uploaded' || !data.drive_file_id) return new Response('not found', { status: 404 })
  const headers: Record<string, string> = { Authorization: `Bearer ${await googleToken()}` }
  const range = req.headers.get('Range')
  if (range) headers.Range = range
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(data.drive_file_id)}?alt=media`, { headers })
  if (!res.ok) {
    await res.body?.cancel()
    return new Response('not found', { status: res.status === 404 ? 404 : res.status === 416 ? 416 : 502 })
  }
  const out = new Headers({ 'Content-Type': data.mime_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' })
  for (const h of ['Content-Length', 'Content-Range']) {
    const v = res.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers: out })
}

Deno.serve((req) => (req.method === 'GET' || req.method === 'HEAD' ? stream(req) : post(req)))
