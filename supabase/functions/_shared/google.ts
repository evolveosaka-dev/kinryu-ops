// Google Drive / Sheets access as the company Google account via an OAuth refresh token
// (scope: drive.file — the app only sees files and folders it created itself).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env, HttpError } from './http.ts'

export const ROOT_FOLDER_NAME = '金龍 朝礼・巡回'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

let cached: { token: string; expires: number } | null = null

export async function googleToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new HttpError(502, `google token: ${json.error_description ?? json.error}`)
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 }
  return cached.token
}

export async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `google ${res.status}: ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export async function kvGet(admin: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await admin.from('app_kv').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

export async function kvSet(admin: SupabaseClient, key: string, value: string): Promise<void> {
  const { error } = await admin.from('app_kv').upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw new HttpError(500, error.message)
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function findOrCreateFolder(name: string, parent: string): Promise<string> {
  const query = `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and '${parent}' in parents and trashed = false`
  const found = await google<{ files: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
  )
  if (found.files[0]) return found.files[0].id
  const created = await google<{ id: string }>('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  })
  return created.id
}

/** Folder id for a path under the root folder, e.g. ['2026-10', '御堂筋店', '巡回']. Cached in app_kv. */
export async function ensureFolder(admin: SupabaseClient, path: string[]): Promise<string> {
  let parent = 'root'
  const parts = [ROOT_FOLDER_NAME, ...path]
  for (let i = 0; i < parts.length; i++) {
    const key = `folder:${parts.slice(0, i + 1).join('/')}`
    const hit = await kvGet(admin, key)
    if (hit) {
      parent = hit
      continue
    }
    parent = await findOrCreateFolder(parts[i]!, parent)
    await kvSet(admin, key, parent)
  }
  return parent
}

/** Forget cached folder ids (after someone moved or deleted a folder in Drive). */
export async function clearFolderCache(admin: SupabaseClient): Promise<void> {
  await admin.from('app_kv').delete().like('key', 'folder:%')
}
