// Persistent upload queue (IndexedDB): files survive reloads and lost signal, and are retried.
import { useQueryClient } from '@tanstack/react-query'
import { createStore, del, entries, set } from 'idb-keyval'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../app/auth'
import { callDriveFunction, uploadToSession, UploadHttpError } from '../../lib/driveUpload'
import { isNetworkError } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { MediaKind, PreparedMedia } from '../../lib/media'

export interface UploadItem {
  id: string
  ownerId: string
  parentType: 'chorei' | 'patrol' | 'miss' | 'stock' | 'incident' | 'lost_found' | 'lost_return' | 'sales'
  parentId: string
  kind: MediaKind
  fileName: string
  mimeType: string
  size: number
  durationSec: number | null
  blob: Blob
  attachmentId?: string
  uploadUrl?: string
  progress: number
  /** when it was put in the queue (ms); older items have none */
  queuedAt?: number
  status: 'queued' | 'uploading' | 'error'
  error?: string
}

interface QueueApi {
  items: UploadItem[]
  enqueue: (parentType: UploadItem['parentType'], parentId: string, media: PreparedMedia[]) => Promise<void>
  retry: () => void
  discard: (id: string) => Promise<void>
  /** the queue right now (also just after enqueue, before React re-renders) */
  current: () => UploadItem[]
  /** files that left the queue in this session: arrived, or given up by the sender (やめる) */
  outcome: Record<string, 'done' | 'dropped'>
  /** called once after sign-in with the files left from an earlier visit (the app was closed while sending) */
  onRestored: (cb: (items: UploadItem[]) => void) => () => void
}

/** Why a file failed, for the sender (the raw error stays in the banner's detail). */
// eslint-disable-next-line react-refresh/only-export-components
export function failReason(error: string | undefined): 'tooLarge' | 'missing' | 'other' {
  if (/too large|too long|413/i.test(error ?? '')) return 'tooLarge'
  if (error === MISSING || /NotFound|NotReadable|could not be found|can ?not be found/i.test(error ?? '')) return 'missing'
  return 'other'
}
const MISSING = 'file missing on this phone'

const QueueContext = createContext<QueueApi>({ items: [], enqueue: async () => {}, retry: () => {}, discard: async () => {}, current: () => [], outcome: {}, onRestored: () => () => {} })

let idbStore: ReturnType<typeof createStore> | null = null
const store = () => (idbStore ??= createStore('kinryu-uploads', 'queue'))

async function persist(item: UploadItem) {
  try {
    await set(item.id, item, store())
  } catch {
    // IndexedDB unavailable (private mode): the upload still runs from memory
  }
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const userId = session?.user.id
  // test accounts upload nothing to Google Drive (their records are deleted every night)
  const isTestAccount = Boolean(profile?.is_test_account)
  const queryClient = useQueryClient()
  const [items, setItems] = useState<UploadItem[]>([])
  const [outcome, setOutcome] = useState<Record<string, 'done' | 'dropped'>>({})
  const running = useRef(false)
  const restoredListeners = useRef(new Set<(items: UploadItem[]) => void>())
  const itemsRef = useRef<UploadItem[]>([])

  // keep the screen on while files are sending: a locked screen or another app stops the upload (iOS / Android)
  const uploading = items.some((i) => i.status === 'uploading')
  useEffect(() => {
    if (!uploading || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let done = false
    const take = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((l) => (done ? void l.release() : (lock = l)))
        .catch(() => {}) // refused (battery saver…): the banner still asks to keep the app open
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release().catch(() => {})
    }
  }, [uploading])

  // itemsRef changes at once (run() reads it right after), the state follows
  const replace = useCallback((item: UploadItem | null, removeId?: string) => {
    const prev = itemsRef.current
    itemsRef.current = removeId ? prev.filter((i) => i.id !== removeId) : prev.map((i) => (i.id === item!.id ? item! : i))
    setItems(itemsRef.current)
  }, [])

  /** Creates the attachment row and the Drive session (no bytes yet). */
  const register = useCallback(async (cur: UploadItem): Promise<UploadItem> => {
    const started = await callDriveFunction<{ attachmentId: string; uploadUrl: string }>({
      action: 'start',
      parentType: cur.parentType,
      parentId: cur.parentId,
      kind: cur.kind,
      fileName: cur.fileName,
      mimeType: cur.mimeType,
      size: cur.size,
      durationSec: cur.durationSec,
    })
    const next = { ...cur, ...started }
    await persist(next)
    return next
  }, [])

  const settle = useCallback(
    async (item: UploadItem, err: unknown) => {
      // Expired/invalid session → start a new one next time.
      const sessionGone = err instanceof UploadHttpError && (err.status === 404 || err.status === 410)
      const permanent = err instanceof UploadHttpError && [400, 403, 409, 413].includes(err.status)
      // signed out / token not refreshable now: keep it queued, the next run (every minute, after sign-in) retries
      const authLater = err instanceof UploadHttpError && err.status === 401
      const cur: UploadItem = {
        ...item,
        status: (isNetworkError(err) && !permanent) || authLater ? 'queued' : 'error',
        error: err instanceof Error ? err.message : String(err),
        ...(sessionGone ? { attachmentId: undefined, uploadUrl: undefined, status: 'queued' as const } : {}),
      }
      await persist(cur)
      replace(cur)
    },
    [replace],
  )

  const processOne = useCallback(
    async (item: UploadItem) => {
      let cur: UploadItem = { ...item, status: 'uploading', error: undefined }
      replace(cur)
      try {
        let resume = Boolean(cur.uploadUrl)
        if (!cur.attachmentId || !cur.uploadUrl) {
          cur = await register(cur)
          resume = false
        }
        // the copy kept by the app can be gone (storage cleared by the phone): say so instead of retrying forever
        try {
          await cur.blob.slice(0, 1).arrayBuffer()
        } catch {
          throw new Error(MISSING)
        }
        let lastPaint = 0
        const file = await uploadToSession(
          cur.uploadUrl!,
          cur.blob,
          (p) => {
            if (Date.now() - lastPaint > 300 || p === 1) {
              lastPaint = Date.now()
              cur = { ...cur, progress: p }
              replace(cur)
            }
          },
          resume,
        )
        await callDriveFunction({ action: 'finish', attachmentId: cur.attachmentId, fileId: file.id })
        await del(cur.id, store()).catch(() => {})
        replace(null, cur.id)
        setOutcome((o) => ({ ...o, [cur.id]: 'done' }))
        void queryClient.invalidateQueries({ queryKey: ['my_chorei'] })
        void queryClient.invalidateQueries({ queryKey: ['my_patrols'] })
        void queryClient.invalidateQueries({ queryKey: ['admin'] })
      } catch (err) {
        await settle(cur, err)
      }
    },
    [queryClient, replace, register, settle],
  )

  const run = useCallback(async () => {
    if (running.current || !navigator.onLine) return
    running.current = true
    // each file is tried once per run; a file that fails again waits for the next run (online / back in the app / every minute)
    const tried = new Set<string>()
    try {
      for (;;) {
        // 1) register every waiting file first (a few small requests): the server knows all files of the report at
        //    once, so a file is never lost without システム knowing, even when the app is closed during the first upload
        for (const i of itemsRef.current.filter((x) => x.status === 'queued' && !x.attachmentId && !tried.has(x.id))) {
          if (!navigator.onLine) break
          try {
            replace(await register(i))
          } catch (err) {
            tried.add(i.id)
            await settle(i, err)
          }
        }
        // 2) send the bytes: photos before videos (a photo arrives in seconds, a video can take minutes)
        const waiting = itemsRef.current.filter((x) => x.status === 'queued' && !tried.has(x.id))
        const next = waiting.find((x) => x.kind === 'image') ?? waiting[0]
        if (!next) break
        tried.add(next.id)
        await processOne(next)
        if (!navigator.onLine) break
      }
    } finally {
      running.current = false
    }
  }, [processOne, register, replace, settle])

  // Load this user's pending uploads after sign-in, then process them.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void entries<string, UploadItem>(store())
      .catch(() => null)
      .then((stored) => {
        if (cancelled) return
        const rows = stored ?? []
        const mine = rows.map(([, v]) => ({ ...v, status: v.status === 'uploading' ? ('queued' as const) : v.status })).filter((v) => v.ownerId === userId)
        // a report sent before this load finished is already in memory (and newer): keep that copy
        const live = itemsRef.current.filter((i) => i.ownerId === userId)
        itemsRef.current = [...mine.filter((m) => !live.some((i) => i.id === m.id)), ...live]
        setItems(itemsRef.current)
        // tell the server which files this phone still holds: its other waiting files are gone (システム shows them as lost).
        // Only when the stored queue could be read (a private window cannot keep files at all).
        if (stored && !isTestAccount) {
          const held = itemsRef.current.flatMap((i) => (i.attachmentId ? [i.attachmentId] : []))
          void supabase.rpc('report_upload_holdings', { p_ids: held }).then(() => undefined, () => undefined)
        }
        const left = mine.filter((m) => !live.some((i) => i.id === m.id))
        if (left.length) restoredListeners.current.forEach((cb) => cb(left))
        void run()
      })
    const onOnline = () => void run()
    // back in the app after the screen was off / another app: continue at once
    const onVisible = () => document.visibilityState === 'visible' && void run()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void run(), 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [userId, run, isTestAccount])

  const enqueue = useCallback<QueueApi['enqueue']>(
    async (parentType, parentId, media) => {
      if (!userId || media.length === 0 || isTestAccount) return
      const added = media.map<UploadItem>((m) => ({
        id: m.id,
        ownerId: userId,
        parentType,
        parentId,
        kind: m.kind,
        fileName: m.fileName,
        mimeType: m.mimeType,
        size: m.size,
        durationSec: m.durationSec,
        blob: m.blob,
        progress: 0,
        queuedAt: Date.now(),
        status: 'queued',
      }))
      // ask the browser not to clear the app's storage when the phone runs low: the queued files live there
      void navigator.storage?.persist?.().catch(() => false)
      await Promise.all(added.map(persist))
      itemsRef.current = [...itemsRef.current, ...added]
      setItems(itemsRef.current)
      void run()
    },
    [userId, run, isTestAccount],
  )

  const retry = useCallback(() => {
    itemsRef.current = itemsRef.current.map((i) => (i.status === 'error' ? { ...i, status: 'queued' } : i))
    setItems(itemsRef.current)
    void run()
  }, [run])

  const discard = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id)
      // the sender gives this file up: the record keeps the files that arrived, and システム does not report it
      if (item?.attachmentId) await callDriveFunction({ action: 'drop', attachmentId: item.attachmentId }).catch(() => {})
      await del(id, store()).catch(() => {})
      replace(null, id)
      setOutcome((o) => ({ ...o, [id]: 'dropped' }))
    },
    [replace],
  )

  const current = useCallback(() => itemsRef.current, [])
  const onRestored = useCallback((cb: (items: UploadItem[]) => void) => {
    restoredListeners.current.add(cb)
    return () => void restoredListeners.current.delete(cb)
  }, [])

  return <QueueContext.Provider value={{ items, enqueue, retry, discard, current, outcome, onRestored }}>{children}</QueueContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUploadQueue = () => useContext(QueueContext)
