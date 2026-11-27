self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only */ });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Lock In', body: e.data && e.data.text() }; }
  const jobs = [self.registration.showNotification(d.title || 'Lock In', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', image: d.image, data: { url: d.url || '/' },
  })];
  // Red number on the home-screen icon, like other apps.
  if (d.badge && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(d.badge).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
