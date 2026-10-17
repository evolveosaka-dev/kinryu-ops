import { describe, expect, it } from 'vitest'
import { detectPhone, iosRow } from './VideoSizeGuide'

const safari = (v: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Mobile/15E148 Safari/604.1`

describe('phone guide', () => {
  it('detects the phone', () => {
    expect(detectPhone(safari('27.0'), 5)).toBe('iphone')
    expect(detectPhone('Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36', 5)).toBe('android')
    expect(detectPhone('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36', 0)).toBeNull()
  })

  it('picks the iOS row from the Safari version', () => {
    expect(iosRow(safari('27.0'))).toBe('ios27')
    expect(iosRow(safari('26.1'))).toBe('ios26')
    expect(iosRow(safari('18.5'))).toBe('older')
    expect(iosRow('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1')).toBeNull()
    expect(iosRow('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36')).toBeNull()
  })
})
