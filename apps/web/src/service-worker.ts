/**
 * EnglishForge PWA Service Worker
 *
 * 缓存策略：
 *   - 预缓存：index.html / favicon.svg / manifest.json
 *   - API 请求（`/api/*`）：stale-while-revalidate（后端数据允许短暂陈旧）
 *   - 静态资源（css/js/fonts/images）：cache-first
 *   - 导航请求：网络优先 + 离线兜底 index.html
 *
 * 版本管理：`englishforge-v1` —— 升级时删除旧缓存。
 *
 * 由 vite-plugin-pwa（strategies: 'injectManifest'）构建为 `/service-worker.js`。
 * 通过 `import.meta.env.PROD` 在生产构建时才注册。
 *
 * 本文件由 `tsconfig.worker.json` 单独编译（lib: ES2023 + WebWorker）。
 * 不能在 `tsconfig.app.json`（DOM lib）下参与类型检查 —— 那里 `self` 会被
 * 解析成 Window，SW 专有的 `skipWaiting` / `clients` / `FetchEvent` 全部不存在。
 *
 * 下方 `export {}` 使本文件成为 module，`declare const self` 才是模块作用域
 * 声明（而非全局 `var self` 重声明），从而与 lib.webworker 内置的
 * `declare var self: WorkerGlobalScope` 共存。
 */

export {};

/** workbox injectManifest 注入的 precache 条目（与 workbox-build manifestEntries 一致） */
interface PrecacheEntry {
  url: string;
  revision: string | null;
}

declare const self: ServiceWorkerGlobalScope & {
  /** vite-plugin-pwa（injectManifest 策略）注入的 precache 清单 */
  readonly __WB_MANIFEST: readonly PrecacheEntry[];
};

const VERSION = 'v1';
const CACHE_NAME = `englishforge-${VERSION}`;

// 手动预缓存（作为 workbox 清单之外的显式兜底）
const PRECACHE_URLS: readonly string[] = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// vite-plugin-pwa 构建时注入的完整 precache 清单（含 hash 版本号）。
// 注意：injectManifest 注入的是 `{ url, revision }` 对象数组，不是字符串 ——
// 必须取 `.url`，否则 `new Request(entry)` 会因 "[object Object]" 抛错。
const WB_MANIFEST_URLS: readonly string[] = (self.__WB_MANIFEST ?? []).map(
  (entry) => entry.url,
);

// ─────────────────────────────────────────────────────────────
// Install：预缓存
// ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE_NAME);
      // 合并手动清单 + workbox 注入清单，去重
      const all = Array.from(new Set<string>([...PRECACHE_URLS, ...WB_MANIFEST_URLS]));
      // 用 `addAll` 原子化写入；单个失败不影响其它
      await Promise.allSettled(
        all.map((url) =>
          cache.add(new Request(url, { mode: 'same-origin' })).catch(() => {
            // 单个 URL 失败时静默跳过（比如 /icons/*.png 缺失也不阻塞安装）
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

// ─────────────────────────────────────────────────────────────
// Activate：清理旧缓存
// ─────────────────────────────────────────────────────────────

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('englishforge-') && k !== CACHE_NAME)
          .map((k) => self.caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ─────────────────────────────────────────────────────────────
// Fetch：分级缓存策略
// ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request;

  // 只处理 GET 与同站请求
  if (req.method !== 'GET' || !isSameOrigin(req)) return;

  const url = new URL(req.url);

  // 1. API 请求：stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(req));
    return;
  }

  // 2. 导航请求（页面跳转）：网络优先，离线兜底 index.html
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(req));
    return;
  }

  // 3. 静态资源：cache-first
  if (isStaticAsset(url)) {
    event.respondWith(handleStaticRequest(req));
    return;
  }

  // 其它请求走默认行为
});

// ─────────────────────────────────────────────────────────────
// 策略实现
// ─────────────────────────────────────────────────────────────

/** API 请求：stale-while-revalidate（先返回缓存，同时后台更新） */
async function handleApiRequest(req: Request): Promise<Response> {
  const cache = await self.caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const networkFetch = fetch(req)
    .then((res) => {
      // 只缓存 2xx 响应
      if (res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => {
      // 网络失败：回退缓存；缓存也没有则返回 504
      return cached ?? new Response('Service Unavailable', { status: 504 });
    });

  // SWR：有缓存立即返回，同时后台刷新
  if (cached) {
    void networkFetch;
    return cached;
  }
  return networkFetch;
}

/** 导航请求：网络优先，离线兜底 index.html */
async function handleNavigationRequest(req: Request): Promise<Response> {
  const cache = await self.caches.open(CACHE_NAME);
  try {
    const networkRes = await fetch(req);
    if (networkRes.ok) {
      await cache.put(req, networkRes.clone());
    }
    return networkRes;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    const indexCached = await cache.match('/index.html');
    if (indexCached) return indexCached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/** 静态资源：cache-first */
async function handleStaticRequest(req: Request): Promise<Response> {
  const cache = await self.caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const networkRes = await fetch(req);
    if (networkRes.ok) {
      await cache.put(req, networkRes.clone());
    }
    return networkRes;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ─────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────

function isSameOrigin(req: Request): boolean {
  const url = new URL(req.url);
  return url.origin === self.location.origin;
}

function isStaticAsset(url: URL): boolean {
  const path = url.pathname;
  return (
    path.startsWith('/assets/') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.woff') ||
    path.endsWith('.woff2') ||
    path.endsWith('.ttf') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.webp') ||
    path.endsWith('.ico') ||
    path.endsWith('.mp3') ||
    path.endsWith('.mp4') ||
    path.endsWith('.wav')
  );
}
