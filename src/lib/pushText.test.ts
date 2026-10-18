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
      expect(PUSH_LABELS[loc].state).toEqual(common.wf.state)
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

  it('writes the staff notifications of part 2', () => {
    const items = [
      { date: '2026-10-20', shift: 'middle', kind: 'added', detail: '⑤17-23' },
      { date: '2026-10-21', shift: 'late', kind: 'removed', detail: '' },
      { date: '2026-10-22', shift: 'early', kind: 'changed', detail: '7:00–12:00' },
      { date: '2026-10-23', shift: 'early', kind: 'added', detail: '' },
    ]
    expect(pushMessage('schedule', { n: 4, items }, 'ja')).toEqual({
      title: '📅 シフトが変わりました（4件）',
      body: '10/20(火) 中番 追加 ⑤17-23 / 10/21(水) 遅番 なくなりました / 10/22(木) 早番 変更 7:00–12:00 / ほか1件',
    })
    expect(pushMessage('consent', { ok: false, cover: 'キタ', date: '2026-10-20', shift: 'late', note: '' }, 'ja')).toEqual({ title: '❌ キタさんは代われません', body: '10/20(火) 遅番。' })
    expect(pushMessage('mgr_change', { event: 'report', consent: 'pending', named: 'キタ', name: 'ミナミ', kind: 'absence', date: '2026-10-20', shift: 'late', from: 1380, to: 1860 }, 'ja').body).toBe(
      '10/20(火) 遅番 23:00–7:00。指名されたキタさんの返事を待っています。',
    )
    expect(pushMessage('comment', { what: 'patrol', date: '2026-10-18', author: '店長', body: 'よくできました' }, 'vi').title).toBe('💬 店長 đã bình luận (Tuần tra 10/18(CN))')
    expect(pushMessage('shift_request', { month: 11, deadline: '10/20', last: true }, 'ja').title).toBe('📝 今日がシフト希望の締め切りです')
    expect(pushMessage('inc_step', { event: 'state', kind: 'complaint', to: 'content_check', actor: '店長', body: '' }, 'ja')).toEqual({
      title: '⚠️ ' + PUSH_LABELS.ja.incident.complaint + '：内容確認',
      body: '店長さんが「内容確認」に進めました。',
    })
    expect(pushMessage('inc_step', { event: 'assign', you: true, kind: 'injury', no: 12 }, 'ja').body).toBe(PUSH_LABELS.ja.incident.injury + '（No.0012）')
    expect(pushMessage('lost_step', { action: 'dispose', desc: '黒い傘', actor: '店長', body: '' }, 'ja')).toEqual({ title: '👜 忘れ物：処分しました', body: '黒い傘。店長' })
  })
})
