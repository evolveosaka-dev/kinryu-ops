// Upload a file to a Google Drive resumable session in chunks, resuming after a dropped connection.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Must be a multiple of 256 KiB (Drive requirement).
export const CHUNK_BYTES = 5 * 1024 * 1024

export class UploadHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Next byte offset from a 308 "Range: bytes=0-N" header (null = nothing received yet). */
export function nextOffset(rangeHeader: string | null): number {
  if (!rangeHeader) return 0
  const m = /bytes=0-(\d+)/.exec(rangeHeader)
  return m ? Number(m[1]) + 1 : 0
}

/** Ask Drive how much of the file it already has. Returns 'done' with the file id if complete. */
async function queryOffset(url: string, size: number): Promise<number | { id: string }> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } })
  if (res.status === 200 || res.status === 201) return (await res.json()) as { id: string }
  if (res.status === 308) return nextOffset(res.headers.get('Range'))
  throw new UploadHttpError(res.status, `drive status ${res.status}`)
}

export async function uploadToSession(
  url: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
  resume: boolean,
): Promise<{ id: string }> {
  let offset = 0
  if (resume) {
    const state = await queryOffset(url, blob.size)
    if (typeof state !== 'number') return state
    offset = state
  }
  for (;;) {
    const end = Math.min(offset + CHUNK_BYTES, blob.size)
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` },
      body: blob.slice(offset, end),
    })
    if (res.status === 200 || res.status === 201) {
      onProgress(1)
      return (await res.json()) as { id: string }
    }
    if (res.status !== 308) throw new UploadHttpError(res.status, `drive upload ${res.status}`)
    // Range may be hidden by CORS; then assume the whole chunk arrived.
    offset = res.headers.get('Range') ? nextOffset(res.headers.get('Range')) : end
    onProgress(offset / blob.size)
  }
}

/** Call the drive-upload Edge Function and surface its error message. */
export async function callDriveFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('drive-upload', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      throw new UploadHttpError(res.status, json.error ?? error.message)
    }
    throw error
  }
  return data as T
}
