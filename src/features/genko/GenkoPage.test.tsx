import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../../app/auth'
import i18n from '../../i18n'
import { GenkoPage } from './GenkoPage'

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter>
          <GenkoPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('GenkoPage', () => {
  it('shows all 6 steps with furigana in Japanese', async () => {
    await i18n.changeLanguage('ja')
    const { container } = renderPage()
    for (const step of ['1. はじめの挨拶', '2. 経営理念', '3. 接客用語', '4. 引継ぎ', '5. 身だしなみ', '6. 締めの挨拶']) {
      expect(screen.getByRole('heading', { name: step })).toBeInTheDocument()
    }
    expect(container.querySelectorAll('ruby').length).toBeGreaterThan(20)
    // furigana can be switched off
    await userEvent.click(screen.getByRole('checkbox', { name: 'ふりがな' }))
    expect(container.querySelectorAll('ruby')).toHaveLength(0)
  })

  it('keeps spoken lines in Japanese and adds romaji + translation in Vietnamese', async () => {
    await i18n.changeLanguage('vi')
    renderPage()
    expect(screen.getAllByText('Irasshai!').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Xin mời vào!').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: '1. Chào mở đầu' })).toBeInTheDocument()
    await i18n.changeLanguage('ja')
  })
})
