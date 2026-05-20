// public/ipad/sw.js — Service worker for the staff iPad/Mobile PWA.
// Handles Web Push events from /api/push/subscribe -> lib/push.ts.
// Notification payload (set by lib/push.ts):
//   { title, body, url, urgent?: boolean, tag?: string, row_uuid?: string }

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'GMH', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'New task assigned';
  const options = {
    body: data.body || '',
    icon: '/ipad/icon-192.png',
    badge: '/ipad/badge-72.png',
    tag: data.tag || data.row_uuid || undefined,
    renotify: true,
    requireInteraction: data.urgent === true,
    data: { url: data.url || '/ipad/', row_uuid: data.row_uuid || null }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/ipad/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a tab is already open, focus it and navigate.
    for (const c of all) {
      if (c.url.includes('/ipad') || c.url.includes('/mobile')) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
