import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, nextOffset } from './driveUpload'
import { canAdd, fitSize } from './media'

describe('fitSize', () => {
  it('scales the long side down to 1600 px and keeps the ratio', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
  it('never scales up', () => {
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('canAdd', () => {
  const imgs = (n: number) => Array.from({ length: n }, () => ({ kind: 'image' as const }))
  it('allows up to 5 photos and 1 video', () => {
    expect(canAdd(imgs(4), 'image')).toBe(true)
    expect(canAdd(imgs(5), 'image')).toBe(false)
    expect(canAdd(imgs(5), 'video')).toBe(true)
    expect(canAdd([{ kind: 'video' }], 'video')).toBe(false)
  })
})

describe('resumable upload helpers', () => {
  it('reads the next offset from a Drive Range header', () => {
    expect(nextOffset(null)).toBe(0)
    expect(nextOffset('bytes=0-5242879')).toBe(5242880)
  })
  it('chunk size is a multiple of 256 KiB', () => {
    expect(CHUNK_BYTES % (256 * 1024)).toBe(0)
  })
})
