import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CustomerItem } from './CustomerItem'

describe('CustomerItem', () => {
  it('asks はい / いいえ and reports the answer', async () => {
    await i18n.changeLanguage('ja')
    const onChange = vi.fn()
    render(<CustomerItem value={{}} onChange={onChange} missing={false} />)
    expect(screen.getByText('帰るお客様は満足そうでしたか？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /いいえ/ }))
    expect(onChange).toHaveBeenCalledWith({ customerSatisfied: false })
  })

  it('いいえ asks for a reason, required when missing', async () => {
    await i18n.changeLanguage('ja')
    render(<CustomerItem value={{ customerSatisfied: false }} onChange={() => {}} missing />)
    expect(screen.getByLabelText(/いいえの理由/)).toBeInTheDocument()
    expect(screen.getByText('入力してください')).toBeInTheDocument()
  })

  it('お客様がいない disables the question', async () => {
    await i18n.changeLanguage('ja')
    const onChange = vi.fn()
    const { rerender } = render(<CustomerItem value={{}} onChange={onChange} missing={false} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'お客様がいない' }))
    expect(onChange).toHaveBeenCalledWith({ customerNone: true, customerSatisfied: undefined })
    rerender(<CustomerItem value={{ customerNone: true }} onChange={onChange} missing />)
    expect(screen.getByRole('radio', { name: /はい/ })).toBeDisabled()
    expect(screen.queryByText('⑥ お客様の満足度に答えてください。')).not.toBeInTheDocument()
  })
})
