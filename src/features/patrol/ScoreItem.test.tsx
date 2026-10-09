import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ScoreItem } from './ScoreItem'

describe('ScoreItem', () => {
  it('shows the criteria text under each score and reports the choice', async () => {
    await i18n.changeLanguage('ja')
    const onChange = vi.fn()
    render(<ScoreItem item="quality" value={undefined} onChange={onChange} />)
    expect(screen.getByText('4点すべて満たす')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /1点が不足/ }))
    expect(onChange).toHaveBeenCalledWith(4)
    await userEvent.click(screen.getByRole('radio', { name: /確認できず/ }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('is translated for other locales', async () => {
    await i18n.changeLanguage('vi')
    render(<ScoreItem item="smile" value={5} onChange={() => {}} />)
    expect(screen.getByText('① Nụ cười')).toBeInTheDocument()
    await i18n.changeLanguage('ja')
  })

  it('locked (マスク利用): buttons are disabled and show the fixed score', async () => {
    await i18n.changeLanguage('ja')
    const onChange = vi.fn()
    render(<ScoreItem item="smile" value={1} locked onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /笑顔が見られない/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /4場面すべて/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /4場面中3場面/ })).toBeDisabled()
  })
})
