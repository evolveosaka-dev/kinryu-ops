// Web push: sends the rows waiting in push_queue to every phone of the person (push_subscriptions), in the
// person's language (profiles.locale, texts in _shared/pushText.ts).
//  - action "send": pg_cron every minute while rows wait (x-cron-secret, checked against Vault notify_secret),
//    or a signed-in person right after テスト通知 (then only their own rows).
// A subscription the push service reports as gone (404 / 410) is deleted. 5 failed attempts → the row is kept with the error.
// Secret VAPID_KEYS = the exported JWK pair { publicKey, privateKey } (public key also in src/lib/push.ts).
import * as webpush from 'jsr:@negrel/webpush@0.5.0'
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'
import { pushMessage } from '../_shared/pushText.ts'

type Admin = ReturnType<typeof adminClient>

interface QueueRow {
  id: number
  user_id: string
  kind: string
  data: Record<string, unknown>
  url: string
  urgent: boolean
  attempts: number
}
interface Sub {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

let server: webpush.ApplicationServer | null = null
async function appServer(): Promise<webpush.ApplicationServer> {
  if (!server) {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(env('VAPID_KEYS')), { extractable: false })
    server = await webpush.ApplicationServer.new({ contactInformation: 'mailto:evolve.osaka@gmail.com', vapidKeys })
  }
  return server
}

async function send(admin: Admin, onlyUser: string | null) {
  let q = admin.from('push_queue').select('id, user_id, kind, data, url, urgent, attempts').is('sent_at', null).lt('attempts', 5).order('id').limit(200)
  if (onlyUser) q = q.eq('user_id', onlyUser)
  const { data: rows, error } = await q
  if (error) throw new HttpError(500, error.message)
  if (!rows?.length) return { sent: 0 }
  const users = [...new Set((rows as QueueRow[]).map((r) => r.user_id))]
  const [{ data: subs }, { data: profiles }] = await Promise.all([
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', users),
    admin.from('profiles').select('id, locale').in('id', users),
  ])
  const locale = new Map((profiles ?? []).map((p) => [p.id as string, (p.locale as string) ?? 'ja']))
  const as = await appServer()
  const gone = new Set<string>()
  let sent = 0
  for (const row of rows as QueueRow[]) {
    const mine = ((subs ?? []) as Sub[]).filter((s) => s.user_id === row.user_id && !gone.has(s.id))
    const msg = pushMessage(row.kind, row.data, locale.get(row.user_id) ?? 'ja')
    const payload = JSON.stringify({ ...msg, url: row.url, tag: `${row.kind}-${row.id}` })
    let ok = 0
    let lastError: string | null = mine.length ? null : 'no subscription'
    for (const s of mine) {
      try {
        await as.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }).pushTextMessage(payload, {
          urgency: row.urgent ? webpush.Urgency.High : webpush.Urgency.Normal,
          ttl: row.kind === 'upload' ? 6 * 3600 : 24 * 3600,
        })
        ok++
        await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('id', s.id)
      } catch (e) {
        if (e instanceof webpush.PushMessageError && [404, 410].includes(e.response.status)) {
          gone.add(s.id)
          await admin.from('push_subscriptions').delete().eq('id', s.id)
        } else {
          lastError = e instanceof webpush.PushMessageError ? `push service ${e.response.status}: ${(await e.response.text()).slice(0, 200)}` : String(e)
        }
      }
    }
    // done when one phone got it, or when there is no phone left to try
    const done = ok > 0 || mine.every((s) => gone.has(s.id))
    await admin
      .from('push_queue')
      .update(done ? { sent_at: new Date().toISOString(), last_error: ok ? null : lastError ?? 'subscription gone' } : { attempts: row.attempts + 1, last_error: lastError })
      .eq('id', row.id)
    if (ok) sent++
  }
  return { sent, rows: rows.length }
}

serve(async (req) => {
  const admin = adminClient()
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data: ok, error } = await admin.rpc('notify_secret_ok', { p: cronSecret })
    if (error || !ok) throw new HttpError(401, 'bad cron secret')
    return send(admin, null)
  }
  const caller = await requireUser(req, admin)
  return send(admin, caller.id)
})
