import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SentNoticeProvider, useSentNotice } from '../../components/SentNotice'
import i18n from '../../i18n'
import type { PreparedMedia } from '../../lib/media'
import { UploadQueueProvider, useUploadQueue } from './uploadQueue'

vi.mock('../../app/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, profile: { is_test_account: false } }) }))

// IndexedDB in memory (jsdom has none)
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>()
  return {
    createStore: () => ({}),
    set: async (k: string, v: unknown) => void m.set(k, v),
    del: async (k: string) => void m.delete(k),
    entries: async () => [...m.entries()],
  }
})

const calls: string[] = []
let release: (() => void) | null = null
// manual: each upload waits for finishOne(); auto: at once, and a file named bad… is refused as too large
let mode: 'manual' | 'auto' = 'manual'
vi.mock('../../lib/driveUpload', () => ({
  UploadHttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
  callDriveFunction: vi.fn(async (b: { action: string; fileName?: string; attachmentId?: string }) => {
    calls.push(b.action === 'start' ? `start ${b.fileName}` : `${b.action} ${b.attachmentId}`)
    return { attachmentId: b.fileName, uploadUrl: `https://drive/${b.fileName}` }
  }),
  uploadToSession: vi.fn(async (url: string, _blob: Blob, onProgress: (p: number) => void) => {
    calls.push(`upload ${url.slice('https://drive/'.length)}`)
    if (mode === 'auto') {
      if (url.includes('bad')) {
        const { UploadHttpError } = await import('../../lib/driveUpload')
        throw new UploadHttpError(413, 'video too large')
      }
      return { id: 'f' }
    }
    onProgress(0.5)
    // the test lets the uploads finish when it wants
    await new Promise<void>((r) => (release = r))
    onProgress(1)
    return { id: 'f' }
  }),
}))

const media = (fileName: string, kind: 'image' | 'video', blob: Blob = new Blob(['x'])): PreparedMedia =>
  ({ id: fileName, kind, fileName, mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4', size: 1000, durationSec: null, blob }) as PreparedMedia

// a copy the phone has lost: reading it fails
const gone = { size: 1000, slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('The object can not be found here.', 'NotFoundError')) }) } as unknown as Blob
let files: () => PreparedMedia[] = () => [media('v1.mp4', 'video'), media('a.jpg', 'image'), media('b.jpg', 'image')]

function Send() {
  const uploads = useUploadQueue()
  const sent = useSentNotice()
  return (
    <button
      type="button"
      onClick={async () => {
        await uploads.enqueue('chorei', 'r1', files())
        sent({ kind: '朝礼記録', photos: 3 })
      }}
    >
      send
    </button>
  )
}

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UploadQueueProvider>
        <SentNoticeProvider>
          <Send />
        </SentNoticeProvider>
      </UploadQueueProvider>
    </QueryClientProvider>,
  )

const finishOne = async () => {
  await act(async () => {
    release?.()
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('upload queue + 送信しました dialog', () => {
  beforeEach(async () => {
    calls.length = 0
    mode = 'manual'
    await i18n.changeLanguage('ja')
  })

  it('registers every file before sending, sends photos before videos, and shows ✅ only when all arrived', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'send' }))
    // all three are known to the server before any byte is sent
    expect(calls.slice(0, 4)).toEqual(['start v1.mp4', 'start a.jpg', 'start b.jpg', 'upload a.jpg'])
    expect(screen.getByRole('heading', { name: '送信中です…' })).toBeInTheDocument()
    expect(screen.getByText(/写真・動画 0\/3件 送信済み/)).toBeInTheDocument()

    // closing while sending warns first
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.getByText(/まだ送信中です/)).toBeInTheDocument()

    await finishOne()
    expect(calls).toContain('upload b.jpg')
    await finishOne()
    expect(calls.at(-1)).toBe('upload v1.mp4')
    expect(screen.getByText(/写真・動画 2\/3件 送信済み/)).toBeInTheDocument()
    await finishOne()
    expect(screen.getByRole('heading', { name: '送信しました' })).toBeInTheDocument()
    expect(screen.getByText('写真・動画 3件もすべて届きました。')).toBeInTheDocument()
    expect(calls.filter((c) => c.startsWith('finish'))).toEqual(['finish a.jpg', 'finish b.jpg', 'finish v1.mp4'])
  })

  it('a file that cannot be sent is given up; the files that arrived are kept', async () => {
    mode = 'auto'
    files = () => [media('a2.jpg', 'image'), media('bad.mp4', 'video')]
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(await screen.findByRole('heading', { name: '届かなかった写真・動画があります' })).toBeInTheDocument()
    expect(screen.getByText(/大きすぎて送れません/)).toBeInTheDocument()
    expect(screen.queryByText('まだ1件も届いていません。')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'このファイルをやめる' }))
    expect(await screen.findByRole('heading', { name: '送信しました' })).toBeInTheDocument()
    expect(screen.getByText('写真・動画 1件もすべて届きました。')).toBeInTheDocument()
    expect(screen.getByText('（1件はやめました）')).toBeInTheDocument()
    expect(calls).toContain('drop bad.mp4')
  })

  it('a copy lost from the phone: when nothing is left, the sender chooses to add files or finish without', async () => {
    mode = 'auto'
    files = () => [media('lost.jpg', 'image', gone)]
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(await screen.findByText(/ファイルが見つかりません/)).toBeInTheDocument()
    expect(screen.getByText('まだ1件も届いていません。')).toBeInTheDocument()
    // nothing was sent for it
    expect(calls.some((c) => c.startsWith('upload lost'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'このファイルをやめる' }))
    expect(await screen.findByRole('heading', { name: '写真・動画が1件も添付されていません' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '📷 写真・動画を選ぶ' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '写真・動画なしで終える' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
