import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AuthProvider } from './app/auth'
import { SentNoticeProvider } from './components/SentNotice'
import { ToastProvider } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { UploadQueueProvider } from './features/attachments/uploadQueue'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: true, staleTime: 30_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <UploadQueueProvider>
            {/* inside the queue: the 送信しました dialog follows the photos/videos of the report */}
            <SentNoticeProvider>
              <App />
              <UpdateBanner />
            </SentNoticeProvider>
          </UploadQueueProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
