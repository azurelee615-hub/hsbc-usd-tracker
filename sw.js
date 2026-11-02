/* 汇丰美元管家 — Service Worker
 * 目标：装上主屏后离线也能打开、填写、查看历史。
 * 策略：
 *   - 页面导航：网络优先，失败回退缓存（保证能拿到最新版，同时断网可用）
 *   - 静态资源：缓存优先，后台更新
 * 升级方式：修改 CACHE_VERSION 后重新部署即可。
 */
'use strict';

var CACHE_VERSION = 'v1';
var CACHE_NAME = 'hsbc-usd-tracker-' + CACHE_VERSION;

var PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 单个资源失败不应让整个安装失败
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () { /* 忽略单个失败 */ });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(request).then(function (hit) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return hit; });

      return hit || network;
    })
  );
});
