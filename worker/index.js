// Push notification handlers — compiled by next-pwa and injected into sw.js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'My Cycling Coach', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      data: { url: data.url ?? '/dashboard' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const url = event.notification.data?.url ?? '/dashboard'
      const existing = list.find(c => c.url.includes('/dashboard'))
      if (existing) return existing.focus()
      return clients.openWindow(url)
    })
  )
})
