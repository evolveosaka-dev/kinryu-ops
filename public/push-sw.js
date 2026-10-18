// Web push, loaded into the generated service worker (vite.config.ts workbox.importScripts).
// The payload comes from the Edge Function send-push: { title, body, url, tag }; url is an app route (HashRouter).
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(d.title || '金龍ラーメン専用アプリ', {
      body: d.body || '',
      tag: d.tag,
      data: { url: d.url || '/' },
      lang: 'ja',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const route = (event.notification.data && event.notification.data.url) || '/'
  const target = new URL(`#${route}`, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope))
      if (open) return open.focus().then(() => open.navigate(target)).catch(() => self.clients.openWindow(target))
      return self.clients.openWindow(target)
    }),
  )
})
