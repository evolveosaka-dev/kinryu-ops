import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox } from '../../components/ui'
import { currentSubscription, disablePush, enablePush, pushSupport, testPush } from '../../lib/push'
import { PhoneGuide } from '../attachments/VideoSizeGuide'

type State = 'loading' | 'on' | 'off' | 'denied'

async function readState(): Promise<State> {
  if (pushSupport() !== 'ok') return 'off'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return (await currentSubscription()) && Notification.permission === 'granted' ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function usePushState() {
  const support = pushSupport()
  const [state, setState] = useState<State>('loading')
  const refresh = () => readState().then(setState)
  useEffect(() => {
    let alive = true
    void readState().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [])
  return { support, state, refresh }
}

/** 設定 → 通知: turn web push on / off on this phone, テスト通知, and what to do on iPhone (ホーム画面に追加) or when blocked. */
export function PushSettings() {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const toast = useToast()
  const { support, state, refresh } = usePushState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="font-bold">
        🔔 {t('push.title')}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-slate-700">
        <li>{t('push.what.recruit')}</li>
        <li>{t('push.what.result')}</li>
        <li>{t('push.what.upload')}</li>
        {isManager && <li>{t('push.what.manager')}</li>}
      </ul>
      {support === 'unsupported' && <p className="rounded-lg bg-slate-100 p-3 text-sm">{t('push.unsupported')}</p>}
      {support === 'install' && (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950 ring-1 ring-amber-300">📱 {t('push.needInstall')}</p>
          <PhoneGuide k="installGuide" icon="📲" />
        </div>
      )}
      {support === 'ok' && state === 'denied' && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">{t('push.denied')}</p>}
      {support === 'ok' && state === 'off' && (
        <Button disabled={busy} onClick={() => run(async () => (await enablePush()) || Promise.reject(new Error(t('push.notAllowed'))), t('push.turnedOn'))}>
          🔔 {t('push.turnOn')}
        </Button>
      )}
      {support === 'ok' && state === 'on' && (
        <>
          <p className="rounded-lg bg-green-50 p-3 text-sm font-bold text-green-900 ring-1 ring-green-200">✅ {t('push.on')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(testPush, t('push.testSent'))}>
              {t('push.test')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(disablePush, t('push.turnedOff'))}>
              {t('push.turnOff')}
            </Button>
          </div>
        </>
      )}
      {error && <ErrorBox message={error} />}
    </Card>
  )
}

const DISMISS_KEY = 'kinryu.pushCardHidden'

/** ホーム: ask once to turn notifications on (hidden for 7 days with あとで). */
export function PushHomeCard() {
  const { t } = useTranslation()
  const { support, state } = usePushState()
  const [hidden, setHidden] = useState(() => {
    try {
      return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now()
    } catch {
      return false
    }
  })
  if (hidden || support === 'unsupported' || state !== 'off') return null
  const hide = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86400_000))
    } catch {
      // private mode: hidden until reload
    }
    setHidden(true)
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-3 text-violet-950">
      <span aria-hidden className="text-2xl">
        🔔
      </span>
      <Link to="/profile" className="flex-1 font-bold">
        {t(support === 'install' ? 'push.homeInstall' : 'push.homeCard')} ›
      </Link>
      <button type="button" onClick={hide} className="min-h-10 rounded-lg px-2 text-sm text-violet-800 underline">
        {t('push.later')}
      </button>
    </div>
  )
}
