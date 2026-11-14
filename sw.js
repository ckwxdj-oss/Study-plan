// 공부 계획 체크 — 서비스 워커 (오프라인에서도 앱이 열리게 해 줌)
//
// 동작 방식
//  · 처음 설치될 때 앱 파일(index.html, 수학 진도표, 아이콘 등)을 기기에 저장해 둔다.
//  · 앱 화면(index.html)과 진도표(CSV)는 "인터넷 먼저": 인터넷이 되면 최신 파일을 받아 저장하고,
//    안 되면 저장해 둔 파일로 연다. → 앱을 고쳐서 올리면 다음에 인터넷이 될 때 자동으로 새 버전이 열림.
//  · 아이콘 같은 나머지 파일은 "저장본 먼저".
//  · 체크 기록은 원래부터 기기(localStorage)에 저장되므로 오프라인에서도 그대로 쓸 수 있다.

const CACHE = 'studyplan-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './math_curriculum.csv',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 주소 뒤의 ?t=... 같은 꼬리는 떼고 저장 (진도표를 부를 때 붙는 값)
function keyOf(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

function isFresh(req, url) {
  return req.mode === 'navigate' || /\/$|\.html$|\.csv$|\.webmanifest$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = keyOf(req.url);

  if (isFresh(req, url)) {
    // 인터넷 먼저 → 실패하면 저장본
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(key);
          if (hit) return hit;
          if (req.mode === 'navigate') {
            const shell = await caches.match(keyOf(new URL('./index.html', self.location).href));
            if (shell) return shell;
          }
          return new Response('오프라인이에요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
    );
    return;
  }

  // 저장본 먼저 → 없으면 인터넷에서 받아 저장
  event.respondWith(
    caches.match(key).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }))
  );
});
