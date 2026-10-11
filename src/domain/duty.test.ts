import { describe, expect, it } from 'vitest'
import { dutyFormLink, dutyStatus, homeDuties, nextDuty, readSlotPreset, type Duty } from './duty'

const duty = (over: Partial<Duty>): Duty => ({
  id: 'd',
  business_date: '2026-10-14',
  shift: 'middle',
  store_id: 's',
  kind: 'chorei',
  time_mode: 'range',
  start_min: 1050, // 17:30
  end_min: 1080, // 18:00
  method: 'extend',
  is_plan: true,
  staff: null,
  done: false,
  ...over,
})
const jst = (s: string) => new Date(`${s}+09:00`)

describe('dutyStatus', () => {
  it('soon → now → missed by the time window; done wins', () => {
    const d = duty({})
    expect(dutyStatus(d, jst('2026-10-14T17:00'))).toBe('soon')
    expect(dutyStatus(d, jst('2026-10-14T17:30'))).toBe('now')
    expect(dutyStatus(d, jst('2026-10-14T18:00'))).toBe('missed')
    expect(dutyStatus({ ...d, done: true }, jst('2026-10-14T17:45'))).toBe('done')
  })
  it('遅番 duties after midnight belong to the previous business date', () => {
    const d = duty({ business_date: '2026-10-16', shift: 'late', start_min: 1380, end_min: 1860, time_mode: 'during' })
    expect(dutyStatus(d, jst('2026-10-17T03:00'))).toBe('now')
  })
})

describe('homeDuties / nextDuty', () => {
  const list = [
    duty({ id: 'a', business_date: '2026-10-14', start_min: 420, end_min: 450, method: 'own', time_mode: 'at' }), // 7:00
    duty({ id: 'b', business_date: '2026-10-14' }), // 17:30–18:00
    duty({ id: 'c', business_date: '2026-10-15', start_min: 420, end_min: 450 }), // tomorrow 7:00
    duty({ id: 'd', business_date: '2026-10-16', start_min: 660, end_min: 690 }), // 2 days later
  ]
  it('lists the next 24 h plus what ended less than an hour ago, in time order', () => {
    expect(homeDuties(list, jst('2026-10-14T07:45')).map((d) => d.id)).toEqual(['a', 'b', 'c'])
    expect(homeDuties(list, jst('2026-10-14T08:30')).map((d) => d.id)).toEqual(['b', 'c'])
  })
  it('next = first open duty after that', () => {
    expect(nextDuty(list, jst('2026-10-14T08:30'))?.id).toBe('d')
    expect(nextDuty(list.map((d) => ({ ...d, done: true })), jst('2026-10-14T08:30'))).toBeNull()
  })
})

describe('form links', () => {
  it('chorei and patrol links carry store, date, shift (and patrol type)', () => {
    expect(dutyFormLink(duty({}), 'sennichimae')).toBe('/chorei?store=sennichimae&date=2026-10-14&shift=middle')
    expect(dutyFormLink(duty({ kind: 'patrol' }), 'midosuji')).toBe('/patrol?store=midosuji&date=2026-10-14&shift=middle&type=after_shift')
    expect(dutyFormLink(duty({ kind: 'patrol', method: 'move' }), 'midosuji')).toContain('type=in_shift')
  })
  it('readSlotPreset ignores invalid values', () => {
    expect(readSlotPreset(new URLSearchParams('store=midosuji&date=2026-10-14&shift=late&type=after_shift'))).toEqual({
      storeCode: 'midosuji',
      date: '2026-10-14',
      shift: 'late',
      patrolType: 'after_shift',
    })
    expect(readSlotPreset(new URLSearchParams('date=x&shift=noon&type=y'))).toEqual({
      storeCode: undefined,
      date: undefined,
      shift: undefined,
      patrolType: undefined,
    })
  })
})
