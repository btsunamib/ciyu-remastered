const SHELL = 'ciyu-remastered-shell-20261007-study-chat-1';
const AUDIO = 'ciyu-remastered-audio-v1';
const FILES = ['./', './index.html', './style.css', './customize.css', './lap.css', './lap-core.js', './lap-ai.js', './lap-ui.js', './ai.js', './ai-ui.js', './study-chat.js', './appearance.js', './icon.svg', './manifest.webmanifest', './app.js', './core.js', './storage.js', './audio.js', './icons.js'];
self.addEventListener('install', event => { event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ciyu-remastered-shell-') && key !== SHELL).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request; if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'dict.youdao.com' && url.pathname === '/dictvoice') {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO); const cached = await cache.match(request.url);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status !== 206 || response.type === 'opaque') {
        try {
          await cache.put(request.url, response.clone());
          const keys = await cache.keys();
          // Opaque cross-origin audio can be charged at several MB per entry by browsers.
          // Bound this cache and expose a clear button instead of silently filling storage.
          if (keys.length > 24) await Promise.all(keys.slice(0, keys.length - 24).map(key => cache.delete(key)));
        } catch { /* Playback still works when caching is unavailable. */ }
      }
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try { return await fetch(request); }
    catch (error) { if (request.mode === 'navigate') return caches.match('./index.html'); throw error; }
  })());
});
