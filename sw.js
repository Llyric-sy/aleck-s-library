const SHELL = 'alecks-library-shell-v1';
const BOOKS = 'alecks-library-books-v1';
const SHELL_FILES = [
  './','./index.html','./styles.css','./app.js','./manifest.webmanifest','./books/catalog.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const clone = res.clone();
      caches.open(req.url.includes('/books/') ? BOOKS : SHELL).then(c => c.put(req, clone));
      return res;
    }).catch(() => {
      if(req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }))
  );
});

self.addEventListener('message', event => {
  if(event.data?.type !== 'CACHE_LIBRARY') return;
  const urls = [...new Set(event.data.urls || [])];
  event.waitUntil((async () => {
    const cache = await caches.open(BOOKS);
    let done = 0;
    for(const raw of urls){
      const url = raw.startsWith('http') ? raw : './' + raw.replace(/^\.\//,'');
      try{
        const hit = await cache.match(url);
        if(!hit){
          const res = await fetch(url);
          if(res.ok) await cache.put(url, res.clone());
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