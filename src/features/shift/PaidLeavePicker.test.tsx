import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { PaidLeavePicker } from './PaidLeavePicker'

function Host({ days = {} }: { days?: Record<string, { early?: 'full' }> }) {
  const [v, setV] = useState<string[]>([])
  return (
    <>
      <PaidLeavePicker month="2026-11-01" value={v} onChange={setV} days={days} shifts={['early']} />
      <output data-testid="v">{v.join(',')}</output>
    </>
  )
}
const day = (n: number) => screen.getAllByRole('button').find((b) => b.textContent?.replace(/\D/g, '') === String(n))!

describe('PaidLeavePicker', () => {
  beforeAll(() => i18n.changeLanguage('ja'))
  it('one by one, and a run of days; 出勤できる days are refused', () => {
    render(<Host days={{ '2026-11-09': { early: 'full' } }} />)
    fireEvent.click(day(3))
    fireEvent.click(day(4))
    fireEvent.click(day(3))
    expect(screen.getByTestId('v').textContent).toBe('2026-11-04')
    fireEvent.click(screen.getByRole('radio', { name: /連続した日/ }))
    expect(screen.getByRole('radio', { name: /連続した日/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(day(12))
    fireEvent.click(day(14))
    expect(screen.getByTestId('v').textContent).toBe('2026-11-04,2026-11-12,2026-11-13,2026-11-14')
    fireEvent.click(day(8))
    fireEvent.click(day(10))
    expect(screen.getByText(/11\/9 は上の「出勤できる日」/)).toBeTruthy()
    expect(screen.getByTestId('v').textContent).toBe('2026-11-04,2026-11-12,2026-11-13,2026-11-14')
  })
})
