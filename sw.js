// Service worker di DRUMS PINBALL: permette l'installazione e il gioco senza rete
const V = 'drums-v10';
const CORE = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(x => { const c = x.clone(); caches.open(V).then(k => k.put('/index.html', c)); return x; }).catch(() => caches.match('/index.html')));
    return;
  }
  if (u.origin === location.origin || u.hostname.endsWith('gstatic.com') || u.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.match(r).then(h => h || fetch(r).then(x => {
      if (x.ok || x.type === 'opaque') { const c = x.clone(); caches.open(V).then(k => k.put(r, c)); }
      return x;
    }).catch(() => h)));
  }
});
