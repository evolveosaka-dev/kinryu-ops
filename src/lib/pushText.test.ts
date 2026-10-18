import { describe, expect, it } from 'vitest'
import { PUSH_LABELS, PUSH_LOCALES, PUSH_TEXT, pushMessage } from '../../supabase/functions/_shared/pushText'

const locales = import.meta.glob<Record<string, any>>('../locales/*/{common,shift}.json', { eager: true, import: 'default' }) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('web push texts', () => {
  it('copies the app labels (shift, change kind, incident kind) in every language', () => {
    for (const loc of PUSH_LOCALES) {
      const common = locales[`../locales/${loc}/common.json`]!
      const shift = locales[`../locales/${loc}/shift.json`]!
      expect(PUSH_LABELS[loc].shift).toEqual(common.shift)
      expect(PUSH_LABELS[loc].incident).toEqual(common.incident.kinds)
      expect(PUSH_LABELS[loc].change).toEqual(shift.change.kind)
      expect(Object.keys(PUSH_TEXT[loc])).toEqual(Object.keys(PUSH_TEXT.ja))
    }
  })

  it('writes the notification in the person’s language', () => {
    const d = { name: 'グエン', kind: 'absence', date: '2026-10-20', shift: 'late', store: '⑤', from: 1380, to: 1860 }
    expect(pushMessage('recruit', d, 'ja')).toEqual({
      title: '🙋 代わりの人を探しています',
      body: '10/20(火) 遅番 23:00–7:00 ⑤。入れる人はアプリで「代われます」を押してください。',
    })
    expect(pushMessage('decided', { ...d, ok: true }, 'vi').title).toBe('✅ Đã được duyệt')
    expect(pushMessage('mgr_change', { ...d, event: 'offer', offer_name: 'ミナミ' }, 'ja').title).toBe('🙋 ミナミさんが代われます')
    expect(pushMessage('mgr_incident', { event: 'created', kind: 'injury' }, 'ja').title).toBe('⚠️ クレーム・事故：' + PUSH_LABELS.ja.incident.injury)
    expect(pushMessage('upload', { n: 3 }, 'xx').title).toBe('📤 送れていない写真・動画があります（3件）')
    expect(pushMessage('test', {}, 'my').title).toBe(PUSH_TEXT.my.test![0])
  })
})
