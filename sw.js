/* TRAIN.ALDO — service worker
   A OGNI RILASCIO incrementa VERSION, altrimenti l'iPhone mostra la versione vecchia. */
var VERSION = 'v21';
var CACHE = 'trainaldo-' + VERSION;
var CORE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'data/program.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(CORE).then(function () {
        // Precache di tutte le foto citate nella scheda
        return fetch('data/program.json').then(function (r) { return r.json(); }).then(function (p) {
          var urls = [];
          Object.keys(p.exercises).forEach(function (k) {
            var ex = p.exercises[k];
            if (ex.img) urls.push('img/' + ex.img + '/0.jpg', 'img/' + ex.img + '/1.jpg');
          });
          return Promise.all(urls.map(function (u) { return c.add(u).catch(function () {}); }));
        });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('trainaldo-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Scheda: prima la rete (così gli aggiornamenti arrivano subito), poi la cache offline
  if (url.origin === location.origin && url.pathname.indexOf('/data/') >= 0 && url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); }); }
        return res;
      }).catch(function () { return caches.match(url.pathname); })
    );
    return;
  }

  // Miniature YouTube: cache al primo uso
  if (url.hostname === 'i.ytimg.com') {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // Tutto il resto: prima la cache, poi la rete (e salva)
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('index.html');
      });
    })
  );
});
