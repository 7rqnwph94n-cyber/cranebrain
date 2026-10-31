/* Offline support: the app shell and libraries come from cache when there is no signal.
   Data never goes through this cache; the app keeps its own copy on the phone and syncs. */
const V='cranebrain-v4';
const SHELL=['/','/index.html','/runtime.js?v=2','/manifest.webmanifest','/icon-192.png?v=2','/icon-512.png?v=2','/apple-touch-icon.png?v=2',
 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(new Request(u,{credentials:'same-origin'})).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!=='cranebrain-photos').map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(u.origin===location.origin&&u.pathname.startsWith('/api/'))return; // always live
 if(r.mode==='navigate'){ // network first so updates and sign-in pages come through; cached app when offline
  e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'){const c=res.clone();caches.open(V).then(x=>x.put('/index.html',c))}return res}).catch(()=>caches.match('/index.html')));return}
 if(u.origin===location.origin&&u.pathname.startsWith('/_blob/')){ // photos: keep a copy on the phone for offline viewing
  e.respondWith(caches.open('cranebrain-photos').then(async c=>{const hit=await c.match(r);if(hit)return hit;const res=await fetch(r);if(res.ok)c.put(r,res.clone());return res}));return}
 e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if((res.ok||res.type==='opaque')&&(u.origin===location.origin||/cdnjs|fonts\.(googleapis|gstatic)/.test(u.host))){const c=res.clone();caches.open(V).then(x=>x.put(r,c))}return res})))});
