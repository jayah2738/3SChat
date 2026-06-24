self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: '3SChat', body: 'New activity', url: '/chat' };
  event.waitUntil(self.registration.showNotification(data.title || '3SChat', {
    body: data.body || 'New activity',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: data.url || '/chat' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client);
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});
