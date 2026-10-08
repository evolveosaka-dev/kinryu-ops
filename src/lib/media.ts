// Prepare photos/videos on the phone before upload (CLAUDE.md §14.5).

export const MAX_IMAGES = 5
export const MAX_VIDEOS = 1
export const MAX_VIDEO_SEC = 60
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const IMAGE_LONG_SIDE = 1600

export type MediaKind = 'image' | 'video'

export interface PreparedMedia {
  id: string
  kind: MediaKind
  blob: Blob
  fileName: string
  mimeType: string
  size: number
  durationSec: number | null
}

export class MediaError extends Error {
  constructor(public code: 'tooLong' | 'tooLarge' | 'unsupported' | 'tooMany') {
    super(code)
  }
}

export function canAdd(existing: readonly Pick<PreparedMedia, 'kind'>[], kind: MediaKind): boolean {
  const n = existing.filter((m) => m.kind === kind).length
  return kind === 'image' ? n < MAX_IMAGES : n < MAX_VIDEOS
}

/** Scale so the long side is at most `max` px. */
export function fitSize(width: number, height: number, max = IMAGE_LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name) || 'photo'
}

async function compressImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  } catch {
    return null // format the browser cannot decode: upload the original
  }
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(v.duration)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new MediaError('unsupported'))
    }
    v.src = url
  })
}

export async function prepareMedia(file: File): Promise<PreparedMedia> {
  const id = crypto.randomUUID()
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file)
    if (compressed) {
      return { id, kind: 'image', blob: compressed, fileName: `${baseName(file.name)}.jpg`, mimeType: 'image/jpeg', size: compressed.size, durationSec: null }
    }
    if (file.size > MAX_IMAGE_BYTES) throw new MediaError('tooLarge')
    return { id, kind: 'image', blob: file, fileName: file.name, mimeType: file.type, size: file.size, durationSec: null }
  }
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) throw new MediaError('tooLarge')
    const duration = await videoDuration(file)
    if (!Number.isFinite(duration) || duration > MAX_VIDEO_SEC + 0.5) throw new MediaError('tooLong')
    return { id, kind: 'video', blob: file, fileName: file.name || 'video.mp4', mimeType: file.type, size: file.size, durationSec: Math.round(duration * 10) / 10 }
  }
  throw new MediaError('unsupported')
}
