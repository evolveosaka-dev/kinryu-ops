import { describe, expect, it } from 'vitest'
import { ALL_STEPS_DONE } from '../../domain/types'
import { choreiSchema, fieldErrors, parseNames, type ChoreiInput } from './schema'

const base: ChoreiInput = {
  store_id: 'store',
  business_date: '2026-10-12',
  shift: 'early',
  participants: [],
  participants_extra: [],
  stock_none: true,
  stock_text: null,
  target_bowls: 201,
  caution_text: null,
  steps_done: ALL_STEPS_DONE,
  skip_reason: null,
}

describe('choreiSchema', () => {
  it('accepts a minimal record', () => {
    expect(choreiSchema.safeParse(base).success).toBe(true)
  })
  it('requires stock text unless "nothing needed"', () => {
    const r = choreiSchema.safeParse({ ...base, stock_none: false, stock_text: '' })
    expect(r.success).toBe(false)
    expect(fieldErrors(r.error!)).toEqual({ stock_text: 'error.required' })
  })
  it('requires a reason when a step was skipped', () => {
    const r = choreiSchema.safeParse({ ...base, steps_done: { ...ALL_STEPS_DONE, grooming: false } })
    expect(fieldErrors(r.error!)).toEqual({ skip_reason: 'error.required' })
    expect(choreiSchema.safeParse({ ...base, steps_done: { ...ALL_STEPS_DONE, grooming: false }, skip_reason: '混雑' }).success).toBe(true)
  })
})

describe('parseNames', () => {
  it('splits Japanese and Latin separators', () => {
    expect(parseNames('グエン、 Ram, ,タナカ')).toEqual(['グエン', 'Ram', 'タナカ'])
  })
})
