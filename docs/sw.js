/* KRX 히트맵 PWA 서비스워커
 * 앱 껍데기(HTML/JS/CSS/아이콘)만 캐시하고, 시세 데이터는 항상 네트워크에서 받는다.
 * 네트워크 우선 → 오프라인일 때만 캐시 사용 (오래된 앱이 눌러붙는 문제 방지)
 */
const CACHE = "krx-map-shell-v1";
const SHELL = ["index.html", "app.js", "style.css", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return p.endsWith("/") || SHELL.some(f => p.endsWith("/" + f));
}

self.addEventListener("fetch", ev => {
  if (ev.request.method !== "GET") return;
  const url = new URL(ev.request.url);
  if (!isShell(url)) return;  // 데이터·외부 요청은 브라우저 기본 동작
  ev.respondWith(
    fetch(ev.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(ev.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }))
  );
});
