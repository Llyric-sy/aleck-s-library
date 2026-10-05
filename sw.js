const SHELL = 'alecks-library-shell-v2';
const BOOKS = 'alecks-library-books-v2';
const SHELL_FILES = [
  './','./index.html','./styles.css','./app.js','./manifest.webmanifest','./books/catalog.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, BOOKS]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  const isBookAsset = url.pathname.includes('/books/') && !url.pathname.endsWith('/catalog.json');

  if(isBookAsset || url.origin !== self.location.origin){
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const clone = res.clone();
        caches.open(BOOKS).then(c => c.put(req, clone));
        return res;
      }))
    );
    return;
  }

  // Network-first for the app shell so updates arrive whenever a connection exists,
  // with cached copies used when reception is unavailable.
  event.respondWith(
    fetch(req).then(res => {
      const clone = res.clone();
      caches.open(SHELL).then(c => c.put(req, clone));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});

self.addEventListener('message', event => {
  if(event.data?.type !== 'CACHE_LIBRARY') return;
  const urls = [...new Set(event.data.urls || [])];
  event.waitUntil((async () => {
    const cache = await caches.open(BOOKS);
    let done = 0;
    for(const raw of urls){
      const url = raw.startsWith('http') ? raw : new URL('./' + raw.replace(/^\.\//,''), self.registration.scope).href;
      try{
        const request = new Request(url, {
          mode: new URL(url).origin === self.location.origin ? 'same-origin' : 'no-cors',
          credentials: 'omit'
        });
        const hit = await cache.match(request);
        if(!hit){
          const res = await fetch(request);
          if(res.ok || res.type === 'opaque') await cache.put(request, res.clone());
        }
      }catch{}
      done++;
      const clients = await self.clients.matchAll({includeUncontrolled:true});
      clients.forEach(c => c.postMessage({type:'CACHE_PROGRESS',done,total:urls.length}));
    }
    const clients = await self.clients.matchAll({includeUncontrolled:true});
    clients.forEach(c => c.postMessage({type:'CACHE_DONE'}));
  })());
});