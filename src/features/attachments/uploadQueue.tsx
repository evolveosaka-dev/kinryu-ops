// Persistent upload queue (IndexedDB): files survive reloads and lost signal, and are retried.
import { useQueryClient } from '@tanstack/react-query'
import { createStore, del, entries, set } from 'idb-keyval'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../app/auth'
import { callDriveFunction, uploadToSession, UploadHttpError } from '../../lib/driveUpload'
import { isNetworkError } from '../../lib/format'
import type { MediaKind, PreparedMedia } from '../../lib/media'

export interface UploadItem {
  id: string
  ownerId: string
  parentType: 'chorei' | 'patrol'
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
  status: 'queued' | 'uploading' | 'error'
  error?: string
}

interface QueueApi {
  items: UploadItem[]
  enqueue: (parentType: UploadItem['parentType'], parentId: string, media: PreparedMedia[]) => Promise<void>
  retry: () => void
  discard: (id: string) => Promise<void>
}

const QueueContext = createContext<QueueApi>({ items: [], enqueue: async () => {}, retry: () => {}, discard: async () => {} })

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
  const { session } = useAuth()
  const userId = session?.user.id
  const queryClient = useQueryClient()
  const [items, setItems] = useState<UploadItem[]>([])
  const running = useRef(false)
  const itemsRef = useRef<UploadItem[]>([])

  const replace = useCallback((item: UploadItem | null, removeId?: string) => {
    setItems((prev) => {
      const next = removeId ? prev.filter((i) => i.id !== removeId) : prev.map((i) => (i.id === item!.id ? item! : i))
      itemsRef.current = next
      return next
    })
  }, [])

  const processOne = useCallback(
    async (item: UploadItem) => {
      let cur: UploadItem = { ...item, status: 'uploading', error: undefined }
      replace(cur)
      try {
        let resume = Boolean(cur.uploadUrl)
        if (!cur.attachmentId || !cur.uploadUrl) {
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
          cur = { ...cur, ...started }
          resume = false
          await persist(cur)
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
        void queryClient.invalidateQueries({ queryKey: ['my_chorei'] })
        void queryClient.invalidateQueries({ queryKey: ['my_patrols'] })
      } catch (err) {
        // Expired/invalid session → start a new one next time.
        const sessionGone = err instanceof UploadHttpError && (err.status === 404 || err.status === 410)
        const permanent = err instanceof UploadHttpError && [400, 403, 409, 413].includes(err.status)
        cur = {
          ...cur,
          status: isNetworkError(err) && !permanent ? 'queued' : 'error',
          error: err instanceof Error ? err.message : String(err),
          ...(sessionGone ? { attachmentId: undefined, uploadUrl: undefined, status: 'queued' as const } : {}),
        }
        await persist(cur)
        replace(cur)
      }
    },
    [queryClient, replace],
  )

  const run = useCallback(async () => {
    if (running.current || !navigator.onLine) return
    running.current = true
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'queued')
        if (!next) break
        await processOne(next)
        if (!navigator.onLine) break
      }
    } finally {
      running.current = false
    }
  }, [processOne])

  // Load this user's pending uploads after sign-in, then process them.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void entries<string, UploadItem>(store())
      .catch(() => [] as [string, UploadItem][])
      .then((rows) => {
        if (cancelled) return
        const mine = rows.map(([, v]) => ({ ...v, status: v.status === 'uploading' ? ('queued' as const) : v.status })).filter((v) => v.ownerId === userId)
        itemsRef.current = mine
        setItems(mine)
        void run()
      })
    const onOnline = () => void run()
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => void run(), 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [userId, run])

  const enqueue = useCallback<QueueApi['enqueue']>(
    async (parentType, parentId, media) => {
      if (!userId || media.length === 0) return
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
        status: 'queued',
      }))
      await Promise.all(added.map(persist))
      itemsRef.current = [...itemsRef.current, ...added]
      setItems(itemsRef.current)
      void run()
    },
    [userId, run],
  )

  const retry = useCallback(() => {
    itemsRef.current = itemsRef.current.map((i) => (i.status === 'error' ? { ...i, status: 'queued' } : i))
    setItems(itemsRef.current)
    void run()
  }, [run])

  const discard = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id)
      if (item?.attachmentId) await callDriveFunction({ action: 'fail', attachmentId: item.attachmentId }).catch(() => {})
      await del(id, store()).catch(() => {})
      replace(null, id)
    },
    [replace],
  )

  return <QueueContext.Provider value={{ items, enqueue, retry, discard }}>{children}</QueueContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUploadQueue = () => useContext(QueueContext)
