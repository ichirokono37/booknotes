// 読書の種 - オフライン用キャッシュ
// アプリを更新したら VERSION を上げてください。
const VERSION = 'booknotes-v3';
const MSAL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js';
const ASSETS = ['./', './index.html', './style.css', './app.js', './sync.js', './config.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', MSAL];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href === MSAL) { // 版数固定のライブラリはキャッシュ優先
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
    return;
  }
  if (url.origin !== location.origin) return; // Graph・ログイン通信には触れない
  // 自分のファイルはネット優先（ブラウザのキャッシュも通さず、更新をすぐ反映）、つながらなければキャッシュ
  e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
