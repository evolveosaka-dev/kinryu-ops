import { supabase } from './supabase'

/** VAPID application server key (public; the private half is the Edge Function secret VAPID_KEYS). */
export const VAPID_PUBLIC_KEY = 'BCzT051rPIR5oVwXx94aUc4_rOWDhRuAmK7dHuNhdP52lmYIbXargEd53UEbAmuE8flx5IeHioSGAKytfrxmv1k'

export type PushSupport = 'ok' | 'install' | 'unsupported'

const isIos = (ua: string, touch: number) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)

/** 'install' = iPhone in Safari: web push works only after ホーム画面に追加 (iOS 16.4+), opened from the icon. */
export function pushSupport(): PushSupport {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  if (isIos(navigator.userAgent, navigator.maxTouchPoints) && !standalone) return 'install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker not ready')), 10000))
  return Promise.race([ready, timeout])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  return (await registration()).pushManager.getSubscription()
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: j.keys?.p256dh ?? '',
    p_auth: j.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

/** Ask permission (must run from a tap), subscribe this phone and save it. Returns false when the person said no. */
export async function enablePush(): Promise<boolean> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false
  const reg = await registration()
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
  await save(sub)
  return true
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}

/** At app start: keep this phone's subscription saved under the signed-in person (it can change or move). */
export async function syncPush() {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await save(sub)
}

/** テスト通知 to my phones, sent at once (not waiting for the 1-minute cron). */
export async function testPush() {
  const { error } = await supabase.rpc('send_test_push')
  if (error) throw error
  await supabase.functions.invoke('send-push', { body: { action: 'send' } })
}
