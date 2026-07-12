/* PF Dashboard service worker — Phase 2 (app shell + offline).
 *
 * Scope: the directory this file is served from (repo root on Pages, i.e.
 * /PersonalFinanceWebsite/). All routing below is written relative to that.
 *
 * Strategies:
 *   - Same-origin navigations  -> network-first, fall back to cached page,
 *                                 then offline.html.
 *   - Same-origin CSS / JS     -> stale-while-revalidate (picks up new ?v=).
 *   - Google Fonts stylesheet  -> stale-while-revalidate.
 *   - Google Fonts files       -> cache-first (immutable, versioned URLs).
 *   - CDN libraries (jsdelivr, -> cache-first, no-cors (opaque). Bump VERSION
 *     sheetjs)                    to evict when you upgrade a pinned version.
 *   - Supabase / Google Sheets -> BYPASS the SW entirely (never cached).
 *   - GitHub API               -> BYPASS (carries the user PAT in headers).
 *   - Everything else x-origin -> network-only (default browser behaviour).
 *
 * Data JSON (amfi_nav.json, stock_prices.json, amfi_isin_map.json) is left to
 * the default network path in Phase 2; runtime caching for it lands in Phase 3.
 */

var VERSION = "v1";
var SHELL_CACHE = "pf-shell-" + VERSION;
var RUNTIME_CACHE = "pf-runtime-" + VERSION;
var FONT_CACHE = "pf-fonts-" + VERSION;
var CDN_CACHE = "pf-cdn-" + VERSION;

// Precache the minimal app shell. HTML pages are precached so the app opens
// offline; CSS/JS warm into the runtime cache on first load via SWR.
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./settings.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

// Hosts the SW must never intercept/cache (auth tokens, per-user live data).
var BYPASS_HOSTS = [
  "supabase.co",
  "supabase.in",
  "sheets.googleapis.com",
  "docs.google.com",
  "drive.google.com",
  "api.github.com"
];

var CDN_HOSTS = ["cdn.jsdelivr.net", "cdn.sheetjs.com"];

// ── Install: precache the shell ─────────────────────────────────────────────
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll is atomic — if any request fails the whole install fails, so
      // fetch individually and ignore misses to stay resilient.
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ── Activate: drop old caches, enable nav preload, claim clients ─────────────
self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      var keep = [SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE, CDN_CACHE];
      var names = await caches.keys();
      await Promise.all(
        names.map(function (n) {
          if (keep.indexOf(n) === -1) return caches.delete(n);
        })
      );
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (e) {}
      }
      await self.clients.claim();
    })()
  );
});

// Allow the page to tell a waiting worker to activate immediately.
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function hostMatches(hostname, list) {
  for (var i = 0; i < list.length; i++) {
    if (hostname === list[i] || hostname.endsWith("." + list[i]) || hostname.indexOf(list[i]) !== -1) {
      return true;
    }
  }
  return false;
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (resp) {
        if (resp && (resp.ok || resp.type === "opaque")) {
          cache.put(request, resp.clone());
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

function cacheFirst(request, cacheName, opaque) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      var req = opaque ? new Request(request.url, { mode: "no-cors" }) : request;
      return fetch(req).then(function (resp) {
        if (resp && (resp.ok || resp.type === "opaque")) {
          cache.put(request, resp.clone());
        }
        return resp;
      });
    });
  });
}

async function networkFirstNavigation(event) {
  var request = event.request;
  try {
    var preload = event.preloadResponse ? await event.preloadResponse : null;
    if (preload) {
      caches.open(SHELL_CACHE).then(function (c) { c.put(request, preload.clone()); });
      return preload;
    }
    var fresh = await fetch(request);
    if (fresh && fresh.ok) {
      var copy = fresh.clone();
      caches.open(SHELL_CACHE).then(function (c) { c.put(request, copy); });
    }
    return fresh;
  } catch (e) {
    var cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    // Try the same path without its query string (?v= variants share a page).
    var noQuery = await caches.match(request.url.split("?")[0]);
    if (noQuery) return noQuery;
    var offline = await caches.match("./offline.html");
    return offline || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

// ── Fetch router ────────────────────────────────────────────────────────────
self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return; // never cache writes

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Hard bypass: auth, live per-user data, GitHub API. Let the browser handle it.
  if (hostMatches(url.hostname, BYPASS_HOSTS)) return;

  // Navigations (page loads).
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  var sameOrigin = url.origin === self.location.origin;

  // Same-origin CSS / JS -> stale-while-revalidate.
  if (sameOrigin && /\.(?:css|js)(?:$|\?)/.test(url.pathname + url.search)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Same-origin icons / images -> cache-first.
  if (sameOrigin && /\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest)(?:$|\?)/.test(url.pathname + url.search)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, false));
    return;
  }

  // Google Fonts: stylesheet (SWR) + font files (cache-first).
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE, false));
    return;
  }

  // Pinned CDN libraries -> cache-first, opaque.
  if (hostMatches(url.hostname, CDN_HOSTS)) {
    event.respondWith(cacheFirst(request, CDN_CACHE, true));
    return;
  }

  // Default: let the network handle it (data JSON, pricing APIs, etc.).
});
