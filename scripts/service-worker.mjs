import { readdir, writeFile } from 'node:fs/promises';
const assets = (await readdir('dist/assets')).map(x => '/assets/' + x);
const version = 'vds-' + Date.now();
await writeFile('dist/sw.js', `const CACHE=${JSON.stringify(version)};
const FILES=${JSON.stringify(['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...assets])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vds-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));return;}
event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));});`);
