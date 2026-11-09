// Service worker of the staff's devices: it only shows the notifications the server pushes (new Boutique order, new
// reservation request) and opens the « Commandes » page on a touch. No fetch handler: it caches nothing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { /* not JSON: the default text below */ }
  const title = typeof message.title === 'string' && message.title ? message.title : 'Limen';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof message.body === 'string' ? message.body : '',
    data: { url: typeof message.url === 'string' && message.url.startsWith('/') && !message.url.startsWith('//') ? message.url : '/#/commandes' },
    icon: '/apple-touch-icon.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/#/commandes';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (here) {
      await here.focus();
      if ('navigate' in here) await here.navigate(new URL(url, self.location.origin).href).catch(() => {});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
