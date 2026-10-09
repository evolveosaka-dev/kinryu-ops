import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { TranslationReview } from './TranslationReview'

const items = [{ key: 'improvements', label: '改善点', original: 'Súp ít hơn vạch mẫu', ja: 'スープが見本の線より少なかった', back: 'Súp ít hơn vạch mẫu' }]

describe('TranslationReview', () => {
  it('shows original, Japanese and the check text; sends the edited Japanese', async () => {
    await i18n.changeLanguage('vi')
    const onConfirm = vi.fn()
    render(<TranslationReview items={items} onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getAllByText('Súp ít hơn vạch mẫu')).toHaveLength(2) // original + back translation
    const box = screen.getByRole('textbox')
    expect(box).toHaveValue('スープが見本の線より少なかった')

    await userEvent.clear(box)
    await userEvent.type(box, 'スープが少なかった')
    expect(screen.getByText(/không được cập nhật/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Gửi nội dung này' }))
    expect(onConfirm).toHaveBeenCalledWith({ improvements: 'スープが少なかった' })
    await i18n.changeLanguage('ja')
  })

  it('cannot send an empty Japanese text; "rewrite" cancels', async () => {
    await i18n.changeLanguage('ja')
    const onCancel = vi.fn()
    render(<TranslationReview items={items} onConfirm={() => {}} onCancel={onCancel} />)
    await userEvent.clear(screen.getByRole('textbox'))
    expect(screen.getByRole('button', { name: 'この内容で送信' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '書き直す' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
